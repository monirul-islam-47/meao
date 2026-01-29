import { randomUUID } from 'crypto'
import type { AuditEntry } from './schema.js'
import type { AuditCategory, AuditSeverity } from './types.js'
import type { AuditStore } from './store/interface.js'
import { JsonlAuditStore } from './store/jsonl.js'
import { getAuditPath } from '../config/paths.js'

/**
 * Options for creating an audit entry.
 */
export interface AuditOptions {
  category: AuditCategory
  action: string
  severity?: AuditSeverity
  requestId?: string
  sessionId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

/**
 * Audit logger service.
 *
 * Provides a simple interface for logging audit events.
 * All entries are automatically sanitized before storage.
 */
export class AuditLogger {
  private readonly store: AuditStore

  constructor(store?: AuditStore) {
    this.store = store ?? new JsonlAuditStore(getAuditPath())
  }

  /**
   * Log an audit entry.
   */
  async log(options: AuditOptions): Promise<void> {
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      category: options.category,
      action: options.action,
      severity: options.severity ?? 'info',
      requestId: options.requestId,
      sessionId: options.sessionId,
      userId: options.userId,
      metadata: options.metadata,
    }

    await this.store.append(entry)
  }

  /**
   * Log a debug-level audit entry.
   */
  async debug(
    category: AuditCategory,
    action: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({ category, action, severity: 'debug', metadata })
  }

  /**
   * Log an info-level audit entry.
   */
  async info(
    category: AuditCategory,
    action: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({ category, action, severity: 'info', metadata })
  }

  /**
   * Log a warning-level audit entry.
   */
  async warning(
    category: AuditCategory,
    action: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({ category, action, severity: 'warning', metadata })
  }

  /**
   * Log an alert-level audit entry.
   */
  async alert(
    category: AuditCategory,
    action: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({ category, action, severity: 'alert', metadata })
  }

  /**
   * Log a critical-level audit entry.
   */
  async critical(
    category: AuditCategory,
    action: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({ category, action, severity: 'critical', metadata })
  }

  /**
   * Query the audit store.
   */
  async query(filter: Parameters<AuditStore['query']>[0]): Promise<AuditEntry[]> {
    return this.store.query(filter)
  }
}

// Singleton instance
let defaultLogger: AuditLogger | null = null

/**
 * Get the default audit logger instance.
 */
export function getAuditLogger(): AuditLogger {
  if (!defaultLogger) {
    defaultLogger = new AuditLogger()
  }
  return defaultLogger
}

/**
 * Reset the default logger (for testing).
 */
export function resetAuditLogger(): void {
  defaultLogger = null
}
