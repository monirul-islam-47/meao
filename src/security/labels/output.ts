import type {
  ContentLabel,
  TrustLevel,
  DataClass,
  ToolCapabilityLabels,
} from './types.js'
import { maxSensitivity } from './propagation.js'
import type { SecretFinding } from '../secrets/types.js'

/**
 * Label tool output based on capability and secret findings.
 *
 * Secret findings elevate data class:
 * - Definite secrets → 'secret'
 * - Probable secrets → at least 'sensitive'
 */
export function labelOutput(
  toolCapability: { name: string; labels?: Partial<ToolCapabilityLabels> },
  secretFindings: SecretFinding[]
): ContentLabel {
  let dataClass: DataClass = toolCapability.labels?.outputDataClass ?? 'internal'
  const trustLevel: TrustLevel = toolCapability.labels?.outputTrust ?? 'verified'

  // Secrets elevate data class
  if (secretFindings.some((f) => f.confidence === 'definite')) {
    dataClass = 'secret'
  } else if (secretFindings.some((f) => f.confidence === 'probable')) {
    dataClass = maxSensitivity(dataClass, 'sensitive')
  }

  return {
    trustLevel,
    dataClass,
    source: { origin: `tool:${toolCapability.name}`, timestamp: new Date() },
  }
}

/**
 * Create a label for user input.
 */
export function labelUserInput(isOwner: boolean): ContentLabel {
  return {
    trustLevel: isOwner ? 'user' : 'verified',
    dataClass: 'sensitive',
    source: { origin: 'user_message', timestamp: new Date() },
  }
}

/**
 * Create a label for web-fetched content.
 */
export function labelWebFetch(url: string): ContentLabel {
  return {
    trustLevel: 'untrusted',
    dataClass: 'internal',
    source: { origin: 'web_fetch', originId: url, timestamp: new Date() },
  }
}

/**
 * Create a label for file read content.
 */
export function labelFileRead(
  path: string,
  isInWorkspace: boolean
): ContentLabel {
  return {
    trustLevel: isInWorkspace ? 'user' : 'untrusted',
    dataClass: 'internal',
    source: { origin: 'read', originId: path, timestamp: new Date() },
  }
}

/**
 * Create a label for system-generated content.
 */
export function labelSystem(origin: string): ContentLabel {
  return {
    trustLevel: 'system',
    dataClass: 'internal',
    source: { origin, timestamp: new Date() },
  }
}
