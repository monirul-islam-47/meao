import { z } from 'zod'

/**
 * Audit entry schema with coerced date for JSON serialization.
 *
 * IMPORTANT: Use z.coerce.date() to handle JSON string → Date conversion.
 * When serialized to JSON, Date becomes an ISO string. When parsed back,
 * we need to coerce it back to a Date object.
 */
export const AuditEntrySchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(), // Handles both Date and ISO string
  category: z.enum([
    'auth',
    'tool',
    'memory',
    'label',
    'channel',
    'config',
    'sandbox',
    'scout',
    'resilience',
  ]),
  action: z.string(),
  severity: z.enum(['debug', 'info', 'warning', 'alert', 'critical']),
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

/**
 * Audit entry type.
 * CANONICAL SOURCE: This is the single source of truth for AuditEntry.
 */
export type AuditEntry = z.infer<typeof AuditEntrySchema>
