/**
 * Audit event categories.
 */
export type AuditCategory =
  | 'auth' // login, logout, pairing
  | 'tool' // Tool execution
  | 'memory' // Memory operations
  | 'label' // Label changes
  | 'channel' // Channel events
  | 'config' // Config changes
  | 'sandbox' // Sandbox enforcement
  | 'scout' // Background scout events
  | 'resilience' // Circuit breaker events

/**
 * Audit event severity levels.
 */
export type AuditSeverity =
  | 'debug'
  | 'info'
  | 'warning'
  | 'alert'
  | 'critical'

// NOTE: AuditEntry is defined in schema.ts and re-exported from index.ts
// DO NOT define AuditEntry here to avoid duplicate types
