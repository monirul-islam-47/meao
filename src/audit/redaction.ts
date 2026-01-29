import type { AuditEntry } from './schema.js'
import { secretDetector } from '../security/secrets/index.js'

/**
 * Fields that must NEVER appear in audit logs.
 *
 * IMPORTANT: Paths are relative to the AuditEntry root object.
 * The 'metadata.' prefix is part of the path, NOT a base path.
 *
 * Example: 'metadata.message.content' means entry.metadata.message.content
 */
const NEVER_LOG_FIELDS = [
  'metadata.message.content', // User message text
  'metadata.tool.output', // Raw tool output
  'metadata.file.content', // File contents
  'metadata.memory.content', // Memory entry content
  'metadata.response.text', // AI response text
]

/**
 * Maximum length for error messages in audit logs.
 */
const MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * Sanitize an audit entry by removing NEVER_LOG fields and sanitizing error messages.
 *
 * This is the SINGLE CHOKE POINT for audit entry sanitization.
 * All audit entries MUST pass through this function before being written.
 */
export function sanitizeAuditEntry(entry: AuditEntry): AuditEntry {
  // Deep clone to avoid mutation
  const sanitized = structuredClone(entry)

  // Remove forbidden fields
  for (const field of NEVER_LOG_FIELDS) {
    deletePath(sanitized as unknown as Record<string, unknown>, field)
  }

  // Sanitize error messages through SecretDetector + truncation (M3)
  if (sanitized.metadata?.errorMessage) {
    sanitized.metadata.errorMessage = sanitizeErrorMessage(
      String(sanitized.metadata.errorMessage)
    )
  }

  return sanitized
}

/**
 * Sanitize error message by redacting secrets and truncating.
 *
 * Uses secretDetector singleton for consistent secret detection across the system.
 */
export function sanitizeErrorMessage(msg: string): string {
  // 1. Run through secretDetector singleton
  const { redacted } = secretDetector.redact(msg, {
    minConfidence: 'probable',
    preserveType: false, // Just show [REDACTED] in error messages
  })

  // 2. Truncate to max length
  return redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

/**
 * Delete a value at a dot-separated path in an object.
 */
function deletePath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.')
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || typeof current[part] !== 'object') {
      return
    }
    current = current[part] as Record<string, unknown>
  }

  delete current[parts[parts.length - 1]]
}
