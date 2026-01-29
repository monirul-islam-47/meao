import { describe, it, expect } from 'vitest'
import { sanitizeAuditEntry, sanitizeErrorMessage } from '../../src/audit/redaction.js'
import type { AuditEntry } from '../../src/audit/schema.js'

describe('sanitizeErrorMessage', () => {
  it('redacts secrets from error messages', () => {
    const openaiKey = 'sk-' + 'a'.repeat(48)
    const error = `API error: invalid key ${openaiKey}`

    const sanitized = sanitizeErrorMessage(error)

    expect(sanitized).not.toContain(openaiKey)
    expect(sanitized).toContain('[REDACTED]')
    expect(sanitized).toContain('API error')
  })

  it('redacts database URLs with credentials', () => {
    const error = 'Connection failed: postgres://user:secretpass@localhost/db'

    const sanitized = sanitizeErrorMessage(error)

    expect(sanitized).not.toContain('secretpass')
    expect(sanitized).toContain('[REDACTED]')
  })

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'
    const error = `Token expired: ${jwt}`

    const sanitized = sanitizeErrorMessage(error)

    expect(sanitized).not.toContain(jwt)
    expect(sanitized).toContain('[REDACTED]')
  })

  it('truncates long error messages to 500 characters', () => {
    const longMessage = 'x'.repeat(1000)

    const sanitized = sanitizeErrorMessage(longMessage)

    expect(sanitized).toHaveLength(500)
  })

  it('truncates AFTER redaction', () => {
    // Create a message where redaction + truncation matters
    const openaiKey = 'sk-' + 'a'.repeat(48)
    const longPrefix = 'y'.repeat(480)
    const error = `${longPrefix}key=${openaiKey}`

    const sanitized = sanitizeErrorMessage(error)

    // Should not contain the actual key (even truncated)
    expect(sanitized).not.toContain('sk-')
    expect(sanitized.length).toBeLessThanOrEqual(500)
  })

  it('preserves non-secret error content', () => {
    const error = 'Connection timeout after 30 seconds'

    const sanitized = sanitizeErrorMessage(error)

    expect(sanitized).toBe(error)
  })
})

describe('sanitizeAuditEntry with SecretDetector (M3)', () => {
  const createEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
    id: 'test-id',
    timestamp: new Date(),
    category: 'tool',
    action: 'execute',
    severity: 'info',
    ...overrides,
  })

  it('sanitizes errorMessage through SecretDetector', () => {
    const openaiKey = 'sk-' + 'a'.repeat(48)
    const entry = createEntry({
      metadata: {
        errorMessage: `Failed with key ${openaiKey}`,
      },
    })

    const sanitized = sanitizeAuditEntry(entry)

    expect(sanitized.metadata?.errorMessage).not.toContain(openaiKey)
    expect(sanitized.metadata?.errorMessage).toContain('[REDACTED]')
  })

  it('truncates errorMessage to 500 chars after redaction', () => {
    const entry = createEntry({
      metadata: {
        errorMessage: 'x'.repeat(1000),
      },
    })

    const sanitized = sanitizeAuditEntry(entry)

    expect(sanitized.metadata?.errorMessage).toHaveLength(500)
  })

  it('still removes NEVER_LOG fields', () => {
    const entry = createEntry({
      metadata: {
        message: { content: 'sensitive message', role: 'user' },
        tool: { output: 'sensitive output', name: 'bash' },
        errorMessage: 'some error',
      },
    })

    const sanitized = sanitizeAuditEntry(entry)

    // NEVER_LOG fields removed
    expect((sanitized.metadata?.message as Record<string, unknown>)?.content).toBeUndefined()
    expect((sanitized.metadata?.tool as Record<string, unknown>)?.output).toBeUndefined()

    // Other fields preserved
    expect((sanitized.metadata?.message as Record<string, unknown>)?.role).toBe('user')
    expect((sanitized.metadata?.tool as Record<string, unknown>)?.name).toBe('bash')
    expect(sanitized.metadata?.errorMessage).toBe('some error')
  })
})
