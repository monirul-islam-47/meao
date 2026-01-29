/**
 * Confidence level for secret detection.
 */
export type Confidence = 'definite' | 'probable' | 'possible'

/**
 * A detected secret in content.
 */
export interface SecretFinding {
  type: string
  service?: string
  confidence: Confidence
  location: {
    start: number
    end: number
  }
  // NOTE: Never include the actual secret value
}

/**
 * Result of secret detection.
 */
export interface SecretDetectionResult {
  hasSecrets: boolean
  confidence: 'none' | Confidence
  findings: SecretFinding[]
  definiteCount: number
  probableCount: number
  possibleCount: number
}

/**
 * Summary of secret findings (safe for audit logs).
 */
export interface SecretSummary {
  totalCount: number
  definiteCount: number
  probableCount: number
  possibleCount: number
  types: string[]
  services: string[]
}

/**
 * Options for redaction.
 */
export interface RedactOptions {
  replacement?: string
  preserveType?: boolean
  minConfidence?: Confidence
}

/**
 * A secret pattern definition.
 */
export interface SecretPattern {
  name: string
  type: string
  service?: string
  pattern: RegExp | null
  customDetector?: (content: string) => SecretFinding[]
}
