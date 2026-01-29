import type { TrustLevel, DataClass, ContentLabel } from './types.js'
import { TRUST_ORDER, DATA_CLASS_ORDER } from './types.js'

/**
 * Get the minimum (least trusted) of two trust levels.
 */
export function minTrust(a: TrustLevel, b: TrustLevel): TrustLevel {
  return TRUST_ORDER[a] < TRUST_ORDER[b] ? a : b
}

/**
 * Get the maximum (most sensitive) of two data classes.
 */
export function maxSensitivity(a: DataClass, b: DataClass): DataClass {
  return DATA_CLASS_ORDER[a] > DATA_CLASS_ORDER[b] ? a : b
}

/**
 * Combine two labels using taint propagation rules:
 * - Trust: lowest wins (conservative)
 * - Data class: highest wins (conservative)
 */
export function combineLabels(
  a: ContentLabel,
  b: ContentLabel
): ContentLabel {
  return {
    trustLevel: minTrust(a.trustLevel, b.trustLevel),
    dataClass: maxSensitivity(a.dataClass, b.dataClass),
    source: { origin: 'combined', timestamp: new Date() },
    inheritedFrom: TRUST_ORDER[a.trustLevel] < TRUST_ORDER[b.trustLevel] ? a : b,
  }
}

/**
 * Propagate labels from multiple inputs.
 */
export function propagateLabel(
  inputs: ContentLabel[],
  newOrigin: string
): ContentLabel {
  if (inputs.length === 0) {
    return {
      trustLevel: 'untrusted',
      dataClass: 'internal',
      source: { origin: newOrigin, timestamp: new Date() },
    }
  }

  if (inputs.length === 1) {
    return {
      ...inputs[0],
      source: { origin: newOrigin, timestamp: new Date() },
      inheritedFrom: inputs[0],
    }
  }

  // Combine all inputs
  let result = inputs[0]
  for (let i = 1; i < inputs.length; i++) {
    result = combineLabels(result, inputs[i])
  }

  return {
    ...result,
    source: { origin: newOrigin, timestamp: new Date() },
  }
}

/**
 * Check if a trust level meets a minimum requirement.
 */
export function meetsTrustRequirement(
  actual: TrustLevel,
  required: TrustLevel
): boolean {
  return TRUST_ORDER[actual] >= TRUST_ORDER[required]
}

/**
 * Check if a data class is at or below a maximum.
 */
export function withinDataClass(
  actual: DataClass,
  maximum: DataClass
): boolean {
  return DATA_CLASS_ORDER[actual] <= DATA_CLASS_ORDER[maximum]
}
