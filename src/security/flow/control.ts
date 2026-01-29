import type { ContentLabel, FlowDecision } from '../labels/types.js'

/**
 * FC-1: Check if content can be sent externally (egress).
 *
 * Rules:
 * - Secret data can NEVER egress
 * - Sensitive data from untrusted sources cannot egress
 */
export function canEgress(
  label: ContentLabel,
  _destination: string
): FlowDecision {
  // Secret data never leaves
  if (label.dataClass === 'secret') {
    return { allowed: false, reason: 'Secret data cannot egress' }
  }

  // Sensitive + untrusted = blocked
  if (label.dataClass === 'sensitive' && label.trustLevel === 'untrusted') {
    return {
      allowed: false,
      reason: 'Untrusted sensitive data cannot egress',
    }
  }

  // Sensitive data requires confirmation
  if (label.dataClass === 'sensitive') {
    return {
      allowed: 'ask',
      reason: 'Sending sensitive data externally requires confirmation',
    }
  }

  return { allowed: true }
}

/**
 * FC-2: Check if content can be written to semantic memory.
 *
 * Rules:
 * - Untrusted content cannot write to semantic memory without confirmation
 * - This prevents prompt injection from persisting false "facts"
 */
export function canWriteSemanticMemory(label: ContentLabel): FlowDecision {
  if (label.trustLevel === 'untrusted') {
    return {
      allowed: false,
      reason: 'Untrusted content cannot write to semantic memory',
      canOverride: true, // User can confirm
    }
  }

  if (label.trustLevel === 'verified') {
    return {
      allowed: 'ask',
      reason: 'Non-owner content requires confirmation for semantic memory',
      canOverride: true,
    }
  }

  return { allowed: true }
}

/**
 * FC-3: Check if content can be written to working memory.
 *
 * More permissive than semantic memory - working memory is session-scoped.
 */
export function canWriteWorkingMemory(label: ContentLabel): FlowDecision {
  // Secret data should be redacted first
  if (label.dataClass === 'secret') {
    return {
      allowed: false,
      reason: 'Secrets must be redacted before storage in working memory',
    }
  }

  return { allowed: true }
}

/**
 * FC-4: Check if a tool chain is allowed (untrusted → leaky tool).
 */
export function canChainTools(
  sourceLabel: ContentLabel,
  targetTool: { canLeakData?: boolean; sanitizesOutput?: boolean }
): FlowDecision {
  // If source is untrusted and target can leak data
  if (sourceLabel.trustLevel === 'untrusted' && targetTool.canLeakData) {
    return {
      allowed: 'ask',
      reason: 'Untrusted content being passed to tool with egress capability',
    }
  }

  // If source contains secrets and target doesn't sanitize
  if (sourceLabel.dataClass === 'secret' && !targetTool.sanitizesOutput) {
    return {
      allowed: false,
      reason: 'Secret data cannot flow to non-sanitizing tool',
    }
  }

  return { allowed: true }
}
