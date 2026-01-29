import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SemanticMemory } from '../../../src/memory/semantic/index.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'

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
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'coffee',
        label: createLabel(),
      })

      const fact = await memory.get(result.entryId!)

      expect(fact).not.toBeNull()
      expect(fact?.subject).toBe('user')
      expect(fact?.predicate).toBe('likes')
      expect(fact?.object).toBe('coffee')
    })

    it('uses default confidence of 1.0', async () => {
      const result = await memory.add({
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'tea',
        label: createLabel(),
      })

      const fact = await memory.get(result.entryId!)
      expect(fact?.confidence).toBe(1.0)
    })

    it('respects custom confidence', async () => {
      const result = await memory.add({
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'tea',
        label: createLabel(),
        confidence: 0.75,
      })

      const fact = await memory.get(result.entryId!)
      expect(fact?.confidence).toBe(0.75)
    })

    it('stores source attribution', async () => {
      const result = await memory.add({
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

      const fact = await memory.get(result.entryId!)
      expect(fact?.source.origin).toBe('file-analysis')
      expect(fact?.source.verifiedBy).toBe('user@example.com')
    })

    it('redacts secrets from content', async () => {
      const result = await memory.add({
        factType: 'entity',
        subject: 'api',
        predicate: 'has_token',
        object: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
        label: createLabel(),
      })

      const fact = await memory.get(result.entryId!)
      expect(fact?.content).toContain('[REDACTED')
      expect(fact?.metadata.redacted).toBe(true)
    })
  })

  describe('update', () => {
    it('updates confidence', async () => {
      const result = await memory.add({
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'music',
        label: createLabel(),
        confidence: 0.5,
      })

      await memory.update(result.entryId!, { confidence: 0.9 })

      const fact = await memory.get(result.entryId!)
      expect(fact?.confidence).toBe(0.9)
    })

    it('adds verifiedBy', async () => {
      const result = await memory.add({
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'music',
        label: createLabel(),
      })

      await memory.update(result.entryId!, { verifiedBy: 'admin@example.com' })

      const fact = await memory.get(result.entryId!)
      expect(fact?.source.verifiedBy).toBe('admin@example.com')
    })

    it('merges metadata', async () => {
      const result = await memory.add({
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'music',
        label: createLabel(),
        metadata: { existing: 'value' },
      })

      await memory.update(result.entryId!, { metadata: { new: 'data' } })

      const fact = await memory.get(result.entryId!)
      expect(fact?.metadata.existing).toBe('value')
      expect(fact?.metadata.new).toBe('data')
    })

    it('returns false for non-existent id', async () => {
      const updated = await memory.update('non-existent', { confidence: 0.9 })
      expect(updated).toBe(false)
    })
  })

  describe('query methods', () => {
    beforeEach(async () => {
      await memory.add({
        factType: 'preference',
        subject: 'alice',
        predicate: 'likes',
        object: 'coffee',
        label: createLabel(),
        confidence: 0.9,
      })
      await memory.add({
        factType: 'preference',
        subject: 'alice',
        predicate: 'dislikes',
        object: 'tea',
        label: createLabel(),
        confidence: 0.8,
      })
      await memory.add({
        factType: 'entity',
        subject: 'bob',
        predicate: 'works_at',
        object: 'TechCorp',
        label: createLabel(),
        confidence: 0.95,
      })
    })

    it('getBySubject returns facts for subject', async () => {
      const facts = await memory.getBySubject('alice')

      expect(facts).toHaveLength(2)
      expect(facts.every((f) => f.subject === 'alice')).toBe(true)
    })

    it('getByPredicate returns facts with predicate', async () => {
      const facts = await memory.getByPredicate('likes')

      expect(facts).toHaveLength(1)
      expect(facts[0].object).toBe('coffee')
    })

    it('getByType returns facts of type', async () => {
      const facts = await memory.getByType('preference')

      expect(facts).toHaveLength(2)
      expect(facts.every((f) => f.factType === 'preference')).toBe(true)
    })

    it('getHighConfidence returns high confidence facts', async () => {
      const facts = await memory.getHighConfidence(0.9)

      expect(facts).toHaveLength(2)
      expect(facts.every((f) => f.confidence >= 0.9)).toBe(true)
    })

    it('query with filter returns matching facts', async () => {
      const facts = await memory.query({
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
        factType: 'preference',
        subject: 'user',
        predicate: 'likes',
        object: 'tests',
        label: createLabel(),
      })

      const deleted = await memory.delete(result.entryId!)

      expect(deleted).toBe(true)
      expect(await memory.get(result.entryId!)).toBeNull()
    })

    it('returns false for non-existent id', async () => {
      const deleted = await memory.delete('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('count', () => {
    it('returns total fact count', async () => {
      expect(await memory.count()).toBe(0)

      await memory.add({
        factType: 'preference',
        subject: 'a',
        predicate: 'p',
        object: 'o',
        label: createLabel(),
      })

      await memory.add({
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
