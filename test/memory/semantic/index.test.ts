import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SemanticMemory } from '../../../src/memory/semantic/index.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'
import type { AuditLogger } from '../../../src/audit/index.js'

function createLabel(overrides: Partial<ContentLabel> = {}): ContentLabel {
  return {
    trustLevel: 'user',
    dataClass: 'internal',
    source: { origin: 'test', timestamp: new Date() },
    ...overrides,
  }
}

describe('SemanticMemory', () => {
  let memory: SemanticMemory

  beforeEach(() => {
    memory = new SemanticMemory({ storePath: ':memory:' })
  })

  afterEach(() => {
    memory.close()
  })

  describe('add (with FC-2 enforcement)', () => {
    it('allows user trust level', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'TypeScript',
        label: createLabel({ trustLevel: 'user' }),
      })

      expect(result.success).toBe(true)
      expect(result.entryId).toBeDefined()
    })

    it('allows system trust level', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'entity',
        subject: 'system',
        predicate: 'has_version',
        object: '1.0.0',
        label: createLabel({ trustLevel: 'system' }),
      })

      expect(result.success).toBe(true)
    })

    it('blocks untrusted content without confirmation', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'instruction',
        subject: 'user',
        predicate: 'wants',
        object: 'malicious action',
        label: createLabel({ trustLevel: 'untrusted' }),
      })

      expect(result.success).toBe(false)
      expect(result.rejected?.reason).toContain('Untrusted')
      expect(result.rejected?.canOverride).toBe(true)
    })

    it('allows untrusted content with user confirmation', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'dark mode',
        label: createLabel({ trustLevel: 'untrusted' }),
        userConfirmed: true,
      })

      expect(result.success).toBe(true)
    })

    it('requires confirmation for verified content', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'relationship',
        subject: 'alice',
        predicate: 'knows',
        object: 'bob',
        label: createLabel({ trustLevel: 'verified' }),
      })

      expect(result.success).toBe(false)
      expect(result.rejected?.canOverride).toBe(true)
    })

    it('allows verified content with confirmation', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'relationship',
        subject: 'alice',
        predicate: 'knows',
        object: 'bob',
        label: createLabel({ trustLevel: 'verified' }),
        userConfirmed: true,
      })

      expect(result.success).toBe(true)
    })

    it('stores fact that can be retrieved', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'coffee',
        label: createLabel(),
      })

      const fact = await memory.get('test-user-1', result.entryId!)

      expect(fact).not.toBeNull()
      expect(fact?.subject).toBe('user')
      expect(fact?.predicate).toBe('likes')
      expect(fact?.object).toBe('coffee')
    })

    it('uses default confidence of 1.0', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'tea',
        label: createLabel(),
      })

      const fact = await memory.get('test-user-1', result.entryId!)
      expect(fact?.confidence).toBe(1.0)
    })

    it('respects custom confidence', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'tea',
        label: createLabel(),
        confidence: 0.75,
      })

      const fact = await memory.get('test-user-1', result.entryId!)
      expect(fact?.confidence).toBe(0.75)
    })

    it('stores source attribution', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'entity',
        subject: 'project',
        predicate: 'uses',
        object: 'TypeScript',
        label: createLabel(),
        source: {
          origin: 'file-analysis',
          verifiedBy: 'user@example.com',
        },
      })

      const fact = await memory.get('test-user-1', result.entryId!)
      expect(fact?.source.origin).toBe('file-analysis')
      expect(fact?.source.verifiedBy).toBe('user@example.com')
    })

    it('redacts secrets from content', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'entity',
        subject: 'api',
        predicate: 'has_token',
        object: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
        label: createLabel(),
      })

      const fact = await memory.get('test-user-1', result.entryId!)
      expect(fact?.content).toContain('[REDACTED')
      expect(fact?.metadata.redacted).toBe(true)
    })
  })

  describe('trust promotion and audit (INV-9)', () => {
    let mockAuditLogger: AuditLogger
    let memoryWithAudit: SemanticMemory
    let auditLogs: Array<{
      category: string
      action: string
      metadata?: Record<string, unknown>
    }>

    beforeEach(() => {
      auditLogs = []
      mockAuditLogger = {
        log: vi.fn(async (options) => {
          auditLogs.push({
            category: options.category,
            action: options.action,
            metadata: options.metadata,
          })
        }),
        debug: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        alert: vi.fn(),
        critical: vi.fn(),
        query: vi.fn(),
      } as unknown as AuditLogger

      memoryWithAudit = new SemanticMemory({
        storePath: ':memory:',
        auditLogger: mockAuditLogger,
      })
    })

    afterEach(() => {
      memoryWithAudit.close()
    })

    it('logs audit entry when untrusted content is confirmed', async () => {
      const result = await memoryWithAudit.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'dark mode',
        label: createLabel({ trustLevel: 'untrusted' }),
        userConfirmed: true,
        source: { origin: 'web_fetch' },
      })

      expect(result.success).toBe(true)
      expect(mockAuditLogger.log).toHaveBeenCalledOnce()
      expect(auditLogs[0].category).toBe('memory')
      expect(auditLogs[0].action).toBe('semantic_memory_write_confirmed')
      expect(auditLogs[0].metadata?.originalTrustLevel).toBe('untrusted')
      expect(auditLogs[0].metadata?.promotedTo).toBe('user')
      expect(auditLogs[0].metadata?.reason).toBe('user_confirmed_as_fact')
      expect(auditLogs[0].metadata?.source).toBe('web_fetch')
    })

    it('logs audit entry when verified content is confirmed', async () => {
      await memoryWithAudit.add({
        userId: 'test-user-1',
        factType: 'relationship',
        subject: 'alice',
        predicate: 'knows',
        object: 'bob',
        label: createLabel({ trustLevel: 'verified' }),
        userConfirmed: true,
      })

      expect(mockAuditLogger.log).toHaveBeenCalledOnce()
      expect(auditLogs[0].metadata?.originalTrustLevel).toBe('verified')
      expect(auditLogs[0].metadata?.promotedTo).toBe('user')
    })

    it('records labelPromotion in fact metadata', async () => {
      const result = await memoryWithAudit.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'light mode',
        label: createLabel({ trustLevel: 'untrusted' }),
        userConfirmed: true,
      })

      const fact = await memoryWithAudit.get('test-user-1', result.entryId!)
      const promotion = fact?.metadata.labelPromotion as {
        scope: string
        originalTrustLevel: string
        promotedTo: string
        reason: string
        authorizedBy: string
        timestamp: Date
      }

      expect(promotion).toBeDefined()
      expect(promotion.scope).toBe('entry')
      expect(promotion.originalTrustLevel).toBe('untrusted')
      expect(promotion.promotedTo).toBe('user')
      expect(promotion.reason).toBe('user_confirmed_as_fact')
      expect(promotion.authorizedBy).toBe('test-user-1')
    })

    it('promotes label trustLevel to user after confirmation', async () => {
      const result = await memoryWithAudit.add({
        userId: 'test-user-1',
        factType: 'entity',
        subject: 'website',
        predicate: 'says',
        object: 'important info',
        label: createLabel({ trustLevel: 'untrusted' }),
        userConfirmed: true,
      })

      const fact = await memoryWithAudit.get('test-user-1', result.entryId!)
      expect(fact?.label.trustLevel).toBe('user')
    })

    it('does not log audit for user trust level (no promotion needed)', async () => {
      await memoryWithAudit.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'vim',
        label: createLabel({ trustLevel: 'user' }),
      })

      expect(mockAuditLogger.log).not.toHaveBeenCalled()
    })

    it('does not log audit when write is blocked', async () => {
      await memoryWithAudit.add({
        userId: 'test-user-1',
        factType: 'instruction',
        subject: 'malicious',
        predicate: 'action',
        object: 'bad',
        label: createLabel({ trustLevel: 'untrusted' }),
        // userConfirmed is false/undefined
      })

      expect(mockAuditLogger.log).not.toHaveBeenCalled()
    })

    it('includes factId in audit metadata (not content)', async () => {
      const result = await memoryWithAudit.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'privacy',
        label: createLabel({ trustLevel: 'untrusted' }),
        userConfirmed: true,
      })

      expect(auditLogs[0].metadata?.factId).toBe(result.entryId)
      // Content should NOT be in audit log
      expect(auditLogs[0].metadata).not.toHaveProperty('subject')
      expect(auditLogs[0].metadata).not.toHaveProperty('predicate')
      expect(auditLogs[0].metadata).not.toHaveProperty('object')
      expect(auditLogs[0].metadata).not.toHaveProperty('content')
    })
  })

  describe('update', () => {
    it('updates confidence', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'music',
        label: createLabel(),
        confidence: 0.5,
      })

      await memory.update('test-user-1', result.entryId!, { confidence: 0.9 })

      const fact = await memory.get('test-user-1', result.entryId!)
      expect(fact?.confidence).toBe(0.9)
    })

    it('adds verifiedBy', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'music',
        label: createLabel(),
      })

      await memory.update('test-user-1', result.entryId!, { verifiedBy: 'admin@example.com' })

      const fact = await memory.get('test-user-1', result.entryId!)
      expect(fact?.source.verifiedBy).toBe('admin@example.com')
    })

    it('merges metadata', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'music',
        label: createLabel(),
        metadata: { existing: 'value' },
      })

      await memory.update('test-user-1', result.entryId!, { metadata: { new: 'data' } })

      const fact = await memory.get('test-user-1', result.entryId!)
      expect(fact?.metadata.existing).toBe('value')
      expect(fact?.metadata.new).toBe('data')
    })

    it('returns false for non-existent id', async () => {
      const updated = await memory.update('test-user-1', 'non-existent', { confidence: 0.9 })
      expect(updated).toBe(false)
    })
  })

  describe('query methods', () => {
    beforeEach(async () => {
      await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'alice',
        predicate: 'likes',
        object: 'coffee',
        label: createLabel(),
        confidence: 0.9,
      })
      await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'alice',
        predicate: 'dislikes',
        object: 'tea',
        label: createLabel(),
        confidence: 0.8,
      })
      await memory.add({
        userId: 'test-user-1',
        factType: 'entity',
        subject: 'bob',
        predicate: 'works_at',
        object: 'TechCorp',
        label: createLabel(),
        confidence: 0.95,
      })
    })

    it('getBySubject returns facts for subject', async () => {
      const facts = await memory.getBySubject('test-user-1', 'alice')

      expect(facts).toHaveLength(2)
      expect(facts.every((f) => f.subject === 'alice')).toBe(true)
    })

    it('getByPredicate returns facts with predicate', async () => {
      const facts = await memory.getByPredicate('test-user-1', 'likes')

      expect(facts).toHaveLength(1)
      expect(facts[0].object).toBe('coffee')
    })

    it('getByType returns facts of type', async () => {
      const facts = await memory.getByType('test-user-1', 'preference')

      expect(facts).toHaveLength(2)
      expect(facts.every((f) => f.factType === 'preference')).toBe(true)
    })

    it('getHighConfidence returns high confidence facts', async () => {
      const facts = await memory.getHighConfidence('test-user-1', 0.9)

      expect(facts).toHaveLength(2)
      expect(facts.every((f) => f.confidence >= 0.9)).toBe(true)
    })

    it('query with filter returns matching facts', async () => {
      const facts = await memory.query({
        userId: 'test-user-1',
        subject: 'alice',
        minConfidence: 0.85,
      })

      expect(facts).toHaveLength(1)
      expect(facts[0].predicate).toBe('likes')
    })
  })

  describe('delete', () => {
    it('deletes fact by id', async () => {
      const result = await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'tests',
        label: createLabel(),
      })

      const deleted = await memory.delete('test-user-1', result.entryId!)

      expect(deleted).toBe(true)
      expect(await memory.get('test-user-1', result.entryId!)).toBeNull()
    })

    it('returns false for non-existent id', async () => {
      const deleted = await memory.delete('test-user-1', 'non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('count', () => {
    it('returns total fact count', async () => {
      expect(await memory.count()).toBe(0)

      await memory.add({
        userId: 'test-user-1',
        factType: 'preference',
        subject: 'a',
        predicate: 'p',
        object: 'o',
        label: createLabel(),
      })

      await memory.add({
        userId: 'test-user-1',
        factType: 'entity',
        subject: 'b',
        predicate: 'q',
        object: 'r',
        label: createLabel(),
      })

      expect(await memory.count()).toBe(2)
    })
  })
})
