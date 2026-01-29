import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteSemanticStore } from '../../../src/memory/semantic/store.js'
import type { SemanticFact, FactType } from '../../../src/memory/types.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'

function createLabel(): ContentLabel {
  return {
    trustLevel: 'user',
    dataClass: 'internal',
    source: { origin: 'test', timestamp: new Date() },
  }
}

function createFact(overrides: Partial<SemanticFact> = {}): SemanticFact {
  return {
    id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'semantic',
    factType: 'preference',
    subject: 'user',
    predicate: 'prefers',
    object: 'TypeScript',
    content: 'user prefers TypeScript',
    confidence: 0.9,
    label: createLabel(),
    source: {
      origin: 'conversation',
      timestamp: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    ...overrides,
  }
}

describe('SqliteSemanticStore', () => {
  let store: SqliteSemanticStore

  beforeEach(() => {
    store = new SqliteSemanticStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  describe('insert', () => {
    it('inserts a fact', async () => {
      const fact = createFact({ id: 'test-1' })
      await store.insert(fact)

      const retrieved = await store.get('test-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.subject).toBe('user')
    })

    it('updates existing fact on duplicate id', async () => {
      const fact1 = createFact({ id: 'test-1', object: 'JavaScript' })
      const fact2 = createFact({ id: 'test-1', object: 'TypeScript' })

      await store.insert(fact1)
      await store.insert(fact2)

      const retrieved = await store.get('test-1')
      expect(retrieved?.object).toBe('TypeScript')
    })

    it('preserves label', async () => {
      const label = createLabel()
      label.trustLevel = 'verified'
      const fact = createFact({ id: 'test-1', label })

      await store.insert(fact)

      const retrieved = await store.get('test-1')
      expect(retrieved?.label.trustLevel).toBe('verified')
    })

    it('preserves source with verifiedBy', async () => {
      const fact = createFact({
        id: 'test-1',
        source: {
          origin: 'user-input',
          timestamp: new Date(),
          verifiedBy: 'user@example.com',
        },
      })

      await store.insert(fact)

      const retrieved = await store.get('test-1')
      expect(retrieved?.source.verifiedBy).toBe('user@example.com')
    })
  })

  describe('query', () => {
    it('filters by subject', async () => {
      await store.insert(createFact({ id: 'a', subject: 'alice' }))
      await store.insert(createFact({ id: 'b', subject: 'bob' }))
      await store.insert(createFact({ id: 'c', subject: 'alice' }))

      const results = await store.query({ subject: 'alice' })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.subject === 'alice')).toBe(true)
    })

    it('filters by predicate', async () => {
      await store.insert(createFact({ id: 'a', predicate: 'likes' }))
      await store.insert(createFact({ id: 'b', predicate: 'dislikes' }))
      await store.insert(createFact({ id: 'c', predicate: 'likes' }))

      const results = await store.query({ predicate: 'likes' })

      expect(results).toHaveLength(2)
    })

    it('filters by object', async () => {
      await store.insert(createFact({ id: 'a', object: 'coffee' }))
      await store.insert(createFact({ id: 'b', object: 'tea' }))

      const results = await store.query({ object: 'coffee' })

      expect(results).toHaveLength(1)
      expect(results[0].object).toBe('coffee')
    })

    it('filters by factType', async () => {
      await store.insert(createFact({ id: 'a', factType: 'preference' }))
      await store.insert(createFact({ id: 'b', factType: 'entity' }))
      await store.insert(createFact({ id: 'c', factType: 'preference' }))

      const results = await store.query({ factType: 'preference' })

      expect(results).toHaveLength(2)
    })

    it('filters by minConfidence', async () => {
      await store.insert(createFact({ id: 'a', confidence: 0.5 }))
      await store.insert(createFact({ id: 'b', confidence: 0.9 }))
      await store.insert(createFact({ id: 'c', confidence: 0.7 }))

      const results = await store.query({ minConfidence: 0.7 })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.confidence >= 0.7)).toBe(true)
    })

    it('filters by since date', async () => {
      const oldDate = new Date('2024-01-01')
      const newDate = new Date('2024-06-01')

      await store.insert(createFact({ id: 'old', createdAt: oldDate }))
      await store.insert(createFact({ id: 'new', createdAt: newDate }))

      const results = await store.query({ since: new Date('2024-03-01') })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('new')
    })

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await store.insert(createFact({ id: `fact-${i}` }))
      }

      const results = await store.query({ limit: 5 })

      expect(results).toHaveLength(5)
    })

    it('combines multiple filters', async () => {
      await store.insert(createFact({ id: 'a', subject: 'alice', confidence: 0.9 }))
      await store.insert(createFact({ id: 'b', subject: 'alice', confidence: 0.5 }))
      await store.insert(createFact({ id: 'c', subject: 'bob', confidence: 0.9 }))

      const results = await store.query({
        subject: 'alice',
        minConfidence: 0.8,
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('a')
    })

    it('returns results sorted by confidence', async () => {
      await store.insert(createFact({ id: 'a', confidence: 0.5 }))
      await store.insert(createFact({ id: 'b', confidence: 0.9 }))
      await store.insert(createFact({ id: 'c', confidence: 0.7 }))

      const results = await store.query({})

      expect(results[0].confidence).toBe(0.9)
      expect(results[1].confidence).toBe(0.7)
      expect(results[2].confidence).toBe(0.5)
    })
  })

  describe('update', () => {
    it('updates confidence', async () => {
      await store.insert(createFact({ id: 'test-1', confidence: 0.5 }))

      const updated = await store.update('test-1', { confidence: 0.9 })

      expect(updated).toBe(true)
      const retrieved = await store.get('test-1')
      expect(retrieved?.confidence).toBe(0.9)
    })

    it('returns false for non-existent id', async () => {
      const updated = await store.update('non-existent', { confidence: 0.9 })
      expect(updated).toBe(false)
    })

    it('updates updatedAt timestamp', async () => {
      const originalDate = new Date('2024-01-01')
      await store.insert(createFact({ id: 'test-1', updatedAt: originalDate }))

      await store.update('test-1', { confidence: 0.9 })

      const retrieved = await store.get('test-1')
      expect(retrieved?.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime())
    })
  })

  describe('get', () => {
    it('returns fact by id', async () => {
      await store.insert(createFact({ id: 'test-1', object: 'Python' }))

      const fact = await store.get('test-1')

      expect(fact).not.toBeNull()
      expect(fact?.object).toBe('Python')
    })

    it('returns null for non-existent id', async () => {
      const fact = await store.get('non-existent')
      expect(fact).toBeNull()
    })
  })

  describe('delete', () => {
    it('deletes fact by id', async () => {
      await store.insert(createFact({ id: 'test-1' }))

      const deleted = await store.delete('test-1')

      expect(deleted).toBe(true)
      expect(await store.get('test-1')).toBeNull()
    })

    it('returns false for non-existent id', async () => {
      const deleted = await store.delete('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('count', () => {
    it('returns total fact count', async () => {
      expect(await store.count()).toBe(0)

      await store.insert(createFact({ id: 'a' }))
      await store.insert(createFact({ id: 'b' }))
      await store.insert(createFact({ id: 'c' }))

      expect(await store.count()).toBe(3)
    })

    it('updates after delete', async () => {
      await store.insert(createFact({ id: 'a' }))
      await store.insert(createFact({ id: 'b' }))

      await store.delete('a')

      expect(await store.count()).toBe(1)
    })
  })
})
