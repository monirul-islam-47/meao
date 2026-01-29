import type { AuditEntry } from './schema.js'

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
 * Sanitize an audit entry by removing NEVER_LOG fields and truncating error messages.
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

  // Truncate error messages
  // (SecretDetector integration added in M3)
  if (sanitized.metadata?.errorMessage) {
    sanitized.metadata.errorMessage = String(
      sanitized.metadata.errorMessage
    ).slice(0, MAX_ERROR_MESSAGE_LENGTH)
  }

  return sanitized
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
