import type { SecretFinding } from './types.js'

/**
 * False positive patterns - things that look like secrets but aren't.
 */
const FALSE_POSITIVE_PATTERNS = [
  // Git commit hashes (40 hex chars)
  { pattern: /\b[0-9a-f]{40}\b/gi, context: /commit|hash|sha|ref/i },

  // Base64 data URIs (images, fonts, etc.)
  { pattern: /data:[^;]+;base64,/gi },

  // Example/placeholder values
  { pattern: /example|placeholder|your[_-]?key|xxx+|test[_-]?key/gi },

  // Version numbers that might look like tokens
  { pattern: /v?\d+\.\d+\.\d+(?:-[a-z0-9]+)?/gi },
]

/**
 * Check if a finding is likely a false positive.
 */
export function isLikelyFalsePositive(
  content: string,
  finding: SecretFinding
): boolean {
  const matchedText = content.slice(finding.location.start, finding.location.end)

  // Check for example/placeholder text
  if (/example|placeholder|xxx+|your[_-]?(?:key|token|secret)/i.test(matchedText)) {
    return true
  }

  // Get surrounding context (100 chars before and after)
  const contextStart = Math.max(0, finding.location.start - 100)
  const contextEnd = Math.min(content.length, finding.location.end + 100)
  const context = content.slice(contextStart, contextEnd)

  // Check if it's a git commit hash
  if (
    finding.type === 'encoded_blob' &&
    /commit|hash|sha1?|ref|HEAD/i.test(context)
  ) {
    return true
  }

  // Check if it's part of a data URI
  if (/data:[^;]+;base64,/i.test(context)) {
    return true
  }

  // Check if it's in a comment about secrets (documentation)
  if (/\/\/.*(?:example|format|looks like)/i.test(context)) {
    return true
  }

  return false
}

/**
 * Filter out likely false positives from findings.
 */
export function reduceFalsePositives(
  content: string,
  findings: SecretFinding[]
): SecretFinding[] {
  return findings.filter((finding) => !isLikelyFalsePositive(content, finding))
}
