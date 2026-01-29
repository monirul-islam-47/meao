// Schema and types
export { AuditEntrySchema, type AuditEntry } from './schema.js'
export type { AuditCategory, AuditSeverity } from './types.js'

// Redaction
export { sanitizeAuditEntry, sanitizeErrorMessage } from './redaction.js'

// Store
export type { AuditStore, AuditFilter } from './store/index.js'
export { JsonlAuditStore } from './store/index.js'

// Service
export {
  AuditLogger,
  getAuditLogger,
  resetAuditLogger,
  type AuditOptions,
} from './service.js'
