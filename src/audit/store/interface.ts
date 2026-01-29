import type { AuditEntry } from '../schema.js'
import type { AuditCategory, AuditSeverity } from '../types.js'

/**
 * Filter options for querying audit entries.
 */
export interface AuditFilter {
  since?: Date
  until?: Date
  category?: AuditCategory
  action?: string
  severity?: AuditSeverity
  limit?: number
}

/**
 * Interface for audit storage backends.
 */
export interface AuditStore {
  /**
   * Append an audit entry to the store.
   * The entry will be sanitized before writing.
   */
  append(entry: AuditEntry): Promise<void>

  /**
   * Query audit entries matching the filter.
   */
  query(filter: AuditFilter): Promise<AuditEntry[]>
}
