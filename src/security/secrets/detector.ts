import type {
  Confidence,
  SecretFinding,
  SecretDetectionResult,
  SecretSummary,
  RedactOptions,
} from './types.js'
import {
  DEFINITE_PATTERNS,
  PROBABLE_PATTERNS,
  POSSIBLE_PATTERNS,
} from './patterns.js'
import { reduceFalsePositives } from './context.js'

const CONFIDENCE_ORDER: Confidence[] = ['possible', 'probable', 'definite']

/**
 * Check if a location is already covered by an existing finding.
 */
function isLocationCovered(findings: SecretFinding[], start: number): boolean {
  return findings.some(
    (f) => start >= f.location.start && start < f.location.end
  )
}

/**
 * SecretDetector class - scans content for secrets and redacts them.
 *
 * Usage:
 *   import { secretDetector } from './secrets'
 *   const result = secretDetector.scan(content)
 *   const { redacted, findings } = secretDetector.redact(content)
 */
class SecretDetector {
  /**
   * Scan text and return all findings with confidence levels.
   */
  scan(text: string): SecretDetectionResult {
    const findings: SecretFinding[] = []

    // Check definite patterns first
    for (const pattern of DEFINITE_PATTERNS) {
      if (!pattern.pattern) continue

      // Reset lastIndex for global patterns
      pattern.pattern.lastIndex = 0
      let match
      while ((match = pattern.pattern.exec(text)) !== null) {
        findings.push({
          confidence: 'definite',
          type: pattern.type,
          service: pattern.service,
          location: { start: match.index, end: match.index + match[0].length },
        })
      }
    }

    // Check probable patterns
    for (const pattern of PROBABLE_PATTERNS) {
      if (!pattern.pattern) continue

      pattern.pattern.lastIndex = 0
      let match
      while ((match = pattern.pattern.exec(text)) !== null) {
        // Skip if already covered by definite
        if (isLocationCovered(findings, match.index)) continue

        findings.push({
          confidence: 'probable',
          type: pattern.type,
          service: pattern.service,
          location: { start: match.index, end: match.index + match[0].length },
        })
      }
    }

    // Check possible patterns (custom detectors)
    for (const pattern of POSSIBLE_PATTERNS) {
      if (pattern.customDetector) {
        const customFindings = pattern.customDetector(text)
        for (const finding of customFindings) {
          if (!isLocationCovered(findings, finding.location.start)) {
            findings.push(finding)
          }
        }
      }
    }

    // Reduce false positives
    const filteredFindings = reduceFalsePositives(text, findings)

    // Sort by location
    filteredFindings.sort((a, b) => a.location.start - b.location.start)

    // Calculate counts
    const definiteCount = filteredFindings.filter(
      (f) => f.confidence === 'definite'
    ).length
    const probableCount = filteredFindings.filter(
      (f) => f.confidence === 'probable'
    ).length
    const possibleCount = filteredFindings.filter(
      (f) => f.confidence === 'possible'
    ).length

    // Determine overall confidence
    let confidence: 'none' | Confidence = 'none'
    if (definiteCount > 0) {
      confidence = 'definite'
    } else if (probableCount > 0) {
      confidence = 'probable'
    } else if (possibleCount > 0) {
      confidence = 'possible'
    }

    return {
      hasSecrets: filteredFindings.length > 0,
      confidence,
      findings: filteredFindings,
      definiteCount,
      probableCount,
      possibleCount,
    }
  }

  /**
   * Redact secrets from text.
   * Returns both the redacted text and the findings.
   */
  redact(
    text: string,
    options: RedactOptions = {}
  ): { redacted: string; findings: SecretFinding[] } {
    const {
      replacement = '[REDACTED]',
      preserveType = true,
      minConfidence = 'probable',
    } = options

    const detection = this.scan(text)

    // Filter by minimum confidence
    const minIndex = CONFIDENCE_ORDER.indexOf(minConfidence)
    const toRedact = detection.findings.filter(
      (f) => CONFIDENCE_ORDER.indexOf(f.confidence) >= minIndex
    )

    // Redact in reverse order to preserve positions
    let result = text
    for (const finding of [...toRedact].reverse()) {
      const replacementText = preserveType
        ? `[REDACTED:${finding.type}${finding.service ? `:${finding.service}` : ''}]`
        : replacement

      result =
        result.slice(0, finding.location.start) +
        replacementText +
        result.slice(finding.location.end)
    }

    return { redacted: result, findings: detection.findings }
  }

  /**
   * Summarize findings for audit metadata (safe - contains no actual secrets).
   */
  summarize(findings: SecretFinding[]): SecretSummary {
    const types = [...new Set(findings.map((f) => f.type))]
    const services = [
      ...new Set(findings.filter((f) => f.service).map((f) => f.service!)),
    ]

    return {
      totalCount: findings.length,
      definiteCount: findings.filter((f) => f.confidence === 'definite').length,
      probableCount: findings.filter((f) => f.confidence === 'probable').length,
      possibleCount: findings.filter((f) => f.confidence === 'possible').length,
      types,
      services,
    }
  }

  /**
   * Quick check for definite secrets.
   */
  hasDefiniteSecret(text: string): boolean {
    const result = this.scan(text)
    return result.definiteCount > 0
  }

  /**
   * Quick check for probable or higher secrets.
   */
  hasProbableSecret(text: string): boolean {
    const result = this.scan(text)
    return result.definiteCount > 0 || result.probableCount > 0
  }

  /**
   * Quick check for any secrets (including possible).
   */
  hasPossibleSecret(text: string): boolean {
    const result = this.scan(text)
    return result.hasSecrets
  }
}

// Export singleton instance
export const secretDetector = new SecretDetector()
