/**
 * Trust level - where did this content come from?
 *
 * Ordering: untrusted < verified < user < system
 * Lower trust = less authority, requires more scrutiny.
 */
export type TrustLevel = 'untrusted' | 'verified' | 'user' | 'system'

/**
 * Data class - how sensitive is this content?
 *
 * Ordering: public < internal < sensitive < secret
 */
export type DataClass = 'public' | 'internal' | 'sensitive' | 'secret'

/**
 * Content label attached to all content flowing through the system.
 */
export interface ContentLabel {
  trustLevel: TrustLevel
  dataClass: DataClass

  source: {
    origin: string
    originId?: string
    timestamp: Date
  }

  inheritedFrom?: ContentLabel
}

/**
 * Trust level ordering (lower number = lower trust).
 */
export const TRUST_ORDER: Record<TrustLevel, number> = {
  untrusted: 0,
  verified: 1,
  user: 2,
  system: 3,
}

/**
 * Data class ordering (higher number = more sensitive).
 */
export const DATA_CLASS_ORDER: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  secret: 3,
}

/**
 * Flow decision from control checks.
 */
export interface FlowDecision {
  allowed: boolean | 'ask'
  reason?: string
  canOverride?: boolean
}

/**
 * Tool capability labels declaration.
 */
export interface ToolCapabilityLabels {
  outputTrust: TrustLevel
  outputDataClass: DataClass
  acceptsUntrusted: boolean
}
