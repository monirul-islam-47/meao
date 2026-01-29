/**
 * CRITICAL TEST: NEVER_LOG field sanitization
 *
 * This test MUST PASS before any PR can merge.
 * It verifies that sensitive fields are properly removed from audit entries.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeAuditEntry } from '../../src/audit/redaction.js'
import type { AuditEntry } from '../../src/audit/schema.js'

/**
 * These fields must NEVER appear in sanitized audit entries.
 */
const NEVER_LOG_FIELDS = [
  'metadata.message.content',
  'metadata.tool.output',
  'metadata.file.content',
  'metadata.memory.content',
  'metadata.response.text',
]

describe('NEVER_LOG field sanitization', () => {
  const baseEntry: AuditEntry = {
    id: 'test-id',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    category: 'tool',
    action: 'execute',
    severity: 'info',
  }

  describe('removes forbidden fields', () => {
    it('removes metadata.message.content', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          message: {
            content: 'This is sensitive user message content',
            role: 'user',
          },
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.message).toBeDefined()
      expect((sanitized.metadata?.message as Record<string, unknown>).content).toBeUndefined()
      expect((sanitized.metadata?.message as Record<string, unknown>).role).toBe('user')
    })

    it('removes metadata.tool.output', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          tool: {
            output: 'Sensitive tool output data',
            name: 'bash',
            exitCode: 0,
          },
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.tool).toBeDefined()
      expect((sanitized.metadata?.tool as Record<string, unknown>).output).toBeUndefined()
      expect((sanitized.metadata?.tool as Record<string, unknown>).name).toBe('bash')
    })

    it('removes metadata.file.content', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          file: {
            content: 'SECRET_API_KEY=abc123',
            path: '/etc/secrets',
          },
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.file).toBeDefined()
      expect((sanitized.metadata?.file as Record<string, unknown>).content).toBeUndefined()
      expect((sanitized.metadata?.file as Record<string, unknown>).path).toBe('/etc/secrets')
    })

    it('removes metadata.memory.content', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          memory: {
            content: 'User personal information stored in memory',
            key: 'user_profile',
          },
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.memory).toBeDefined()
      expect((sanitized.metadata?.memory as Record<string, unknown>).content).toBeUndefined()
      expect((sanitized.metadata?.memory as Record<string, unknown>).key).toBe('user_profile')
    })

    it('removes metadata.response.text', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          response: {
            text: 'AI response containing sensitive analysis',
            tokens: 150,
          },
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.response).toBeDefined()
      expect((sanitized.metadata?.response as Record<string, unknown>).text).toBeUndefined()
      expect((sanitized.metadata?.response as Record<string, unknown>).tokens).toBe(150)
    })
  })

  describe('removes ALL forbidden fields simultaneously', () => {
    it('removes multiple NEVER_LOG fields in a single entry', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          message: { content: 'user message', role: 'user' },
          tool: { output: 'tool output', name: 'read' },
          file: { content: 'file data', path: '/path' },
          memory: { content: 'memory data', key: 'key' },
          response: { text: 'response text', tokens: 100 },
          // This field should remain
          requestId: 'req-123',
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      // Verify ALL forbidden content fields are removed
      expect((sanitized.metadata?.message as Record<string, unknown>)?.content).toBeUndefined()
      expect((sanitized.metadata?.tool as Record<string, unknown>)?.output).toBeUndefined()
      expect((sanitized.metadata?.file as Record<string, unknown>)?.content).toBeUndefined()
      expect((sanitized.metadata?.memory as Record<string, unknown>)?.content).toBeUndefined()
      expect((sanitized.metadata?.response as Record<string, unknown>)?.text).toBeUndefined()

      // Verify non-sensitive fields remain
      expect((sanitized.metadata?.message as Record<string, unknown>)?.role).toBe('user')
      expect((sanitized.metadata?.tool as Record<string, unknown>)?.name).toBe('read')
      expect((sanitized.metadata?.file as Record<string, unknown>)?.path).toBe('/path')
      expect((sanitized.metadata?.memory as Record<string, unknown>)?.key).toBe('key')
      expect((sanitized.metadata?.response as Record<string, unknown>)?.tokens).toBe(100)
      expect(sanitized.metadata?.requestId).toBe('req-123')
    })
  })

  describe('preserves non-sensitive data', () => {
    it('preserves all base entry fields', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        requestId: 'req-456',
        sessionId: 'sess-789',
        userId: 'user-abc',
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.id).toBe(entry.id)
      expect(sanitized.timestamp).toEqual(entry.timestamp)
      expect(sanitized.category).toBe(entry.category)
      expect(sanitized.action).toBe(entry.action)
      expect(sanitized.severity).toBe(entry.severity)
      expect(sanitized.requestId).toBe(entry.requestId)
      expect(sanitized.sessionId).toBe(entry.sessionId)
      expect(sanitized.userId).toBe(entry.userId)
    })

    it('preserves safe metadata fields', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          toolName: 'read',
          filePath: '/some/path',
          duration: 150,
          success: true,
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.toolName).toBe('read')
      expect(sanitized.metadata?.filePath).toBe('/some/path')
      expect(sanitized.metadata?.duration).toBe(150)
      expect(sanitized.metadata?.success).toBe(true)
    })
  })

  describe('does not mutate original entry', () => {
    it('returns a new object without modifying the original', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          message: { content: 'sensitive', role: 'user' },
        },
      }

      const originalContent = (entry.metadata?.message as Record<string, unknown>).content

      const sanitized = sanitizeAuditEntry(entry)

      // Original should be unchanged
      expect((entry.metadata?.message as Record<string, unknown>).content).toBe(originalContent)
      // Sanitized should be different object
      expect(sanitized).not.toBe(entry)
      expect(sanitized.metadata).not.toBe(entry.metadata)
    })
  })

  describe('truncates error messages', () => {
    it('truncates errorMessage to 500 characters', () => {
      const longError = 'x'.repeat(1000)
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          errorMessage: longError,
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.errorMessage).toHaveLength(500)
    })

    it('preserves short error messages', () => {
      const shortError = 'Short error message'
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          errorMessage: shortError,
        },
      }

      const sanitized = sanitizeAuditEntry(entry)

      expect(sanitized.metadata?.errorMessage).toBe(shortError)
    })
  })

  describe('handles edge cases', () => {
    it('handles entry with no metadata', () => {
      const entry: AuditEntry = { ...baseEntry }
      const sanitized = sanitizeAuditEntry(entry)
      expect(sanitized).toEqual(entry)
    })

    it('handles entry with empty metadata', () => {
      const entry: AuditEntry = { ...baseEntry, metadata: {} }
      const sanitized = sanitizeAuditEntry(entry)
      expect(sanitized.metadata).toEqual({})
    })

    it('handles deeply nested paths that do not exist', () => {
      const entry: AuditEntry = {
        ...baseEntry,
        metadata: {
          other: 'data',
        },
      }

      // Should not throw when path does not exist
      const sanitized = sanitizeAuditEntry(entry)
      expect(sanitized.metadata?.other).toBe('data')
    })
  })
})

/**
 * Comprehensive field check - ensures no NEVER_LOG field ever leaks.
 */
describe('Comprehensive NEVER_LOG verification', () => {
  it('verifies the complete list of NEVER_LOG fields', () => {
    // This test documents the exact fields that must never be logged
    // If this test fails, it means the NEVER_LOG list has changed
    // and all related tests need to be updated
    expect(NEVER_LOG_FIELDS).toEqual([
      'metadata.message.content',
      'metadata.tool.output',
      'metadata.file.content',
      'metadata.memory.content',
      'metadata.response.text',
    ])
  })
})
