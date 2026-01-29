import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteVectorStore } from '../../../src/memory/episodic/store.js'
import type { EpisodicEntry } from '../../../src/memory/types.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'

function createLabel(): ContentLabel {
  return {
    trustLevel: 'user',
    dataClass: 'internal',
    source: { origin: 'test', timestamp: new Date() },
  }
}

// Use small embedding dimension for test consistency
const TEST_DIMENSIONS = 4

let entryCounter = 0
function createEntry(overrides: Partial<EpisodicEntry> = {}): EpisodicEntry {
  entryCounter++
  return {
    id: `entry-${entryCounter}-${Math.random().toString(36).slice(2)}`,
    type: 'episodic',
    content: 'Test content',
    embedding: new Array(TEST_DIMENSIONS).fill(0).map(() => Math.random() - 0.5),
    sessionId: 'session-1',
    turnNumber: 1,
    participants: ['user', 'assistant'],
    label: createLabel(),
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    ...overrides,
  }
}

describe('SqliteVectorStore', () => {
  let store: SqliteVectorStore

  beforeEach(() => {
    // Use in-memory database for tests
    store = new SqliteVectorStore(':memory:', TEST_DIMENSIONS)
  })

  afterEach(() => {
    store.close()
  })

  describe('insert', () => {
    it('inserts an entry', async () => {
      const entry = createEntry({ id: 'test-1' })
      await store.insert(entry)

      const retrieved = await store.get('test-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.content).toBe('Test content')
    })

    it('updates existing entry on duplicate id', async () => {
      const entry1 = createEntry({ id: 'test-1', content: 'Original' })
      const entry2 = createEntry({ id: 'test-1', content: 'Updated' })

      await store.insert(entry1)
      await store.insert(entry2)

      const retrieved = await store.get('test-1')
      expect(retrieved?.content).toBe('Updated')
    })

    it('preserves embedding', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      const entry = createEntry({ id: 'test-1', embedding })

      await store.insert(entry)

      const retrieved = await store.get('test-1')
      expect(retrieved?.embedding).toEqual(embedding)
    })

    it('preserves label', async () => {
      const label = createLabel()
      label.trustLevel = 'untrusted'
      const entry = createEntry({ id: 'test-1', label })

      await store.insert(entry)

      const retrieved = await store.get('test-1')
      expect(retrieved?.label.trustLevel).toBe('untrusted')
    })
  })

  describe('search', () => {
    it('finds similar entries', async () => {
      // Insert entries with known embeddings
      const entry1 = createEntry({
        id: 'similar',
        embedding: [1, 0, 0, 0],
      })
      const entry2 = createEntry({
        id: 'different',
        embedding: [0, 1, 0, 0],
      })

      await store.insert(entry1)
      await store.insert(entry2)

      // Search with embedding similar to entry1
      const results = await store.search([0.9, 0.1, 0, 0], 10)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('similar')
    })

    it('respects limit parameter', async () => {
      // Insert multiple entries
      for (let i = 0; i < 10; i++) {
        await store.insert(createEntry({ id: `entry-${i}` }))
      }

      // Use minSimilarity=-1 to include all entries (cosine similarity range is -1 to 1)
      const results = await store.search([0.5, 0.5, 0.5, 0.5], 5, -1)
      expect(results).toHaveLength(5)
    })

    it('filters by minSimilarity', async () => {
      // Insert entries with very different embeddings
      const entry1 = createEntry({
        id: 'high-sim',
        embedding: [1, 0, 0, 0],
      })
      const entry2 = createEntry({
        id: 'low-sim',
        embedding: [-1, 0, 0, 0],
      })

      await store.insert(entry1)
      await store.insert(entry2)

      // Search with high minSimilarity
      const results = await store.search([1, 0, 0, 0], 10, 0.9)

      // Should only find the highly similar entry
      expect(results.every((r) => r.similarity >= 0.9)).toBe(true)
    })

    it('returns results sorted by similarity', async () => {
      const entries = [
        createEntry({ id: 'a', embedding: [0.1, 0.9, 0, 0] }),
        createEntry({ id: 'b', embedding: [0.9, 0.1, 0, 0] }),
        createEntry({ id: 'c', embedding: [0.5, 0.5, 0, 0] }),
      ]

      for (const entry of entries) {
        await store.insert(entry)
      }

      // Search for something similar to [1, 0, 0, 0]
      const results = await store.search([1, 0, 0, 0], 10)

      // Should be sorted by similarity (highest first)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(
          results[i].similarity
        )
      }
    })
  })

  describe('query', () => {
    it('filters by sessionId', async () => {
      await store.insert(createEntry({ id: 'a', sessionId: 'session-1' }))
      await store.insert(createEntry({ id: 'b', sessionId: 'session-2' }))
      await store.insert(createEntry({ id: 'c', sessionId: 'session-1' }))

      const results = await store.query({ sessionId: 'session-1' })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.sessionId === 'session-1')).toBe(true)
    })

    it('filters by since date', async () => {
      const oldDate = new Date('2024-01-01')
      const newDate = new Date('2024-06-01')

      await store.insert(createEntry({ id: 'old', createdAt: oldDate }))
      await store.insert(createEntry({ id: 'new', createdAt: newDate }))

      const results = await store.query({ since: new Date('2024-03-01') })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('new')
    })

    it('combines filters', async () => {
      const date = new Date('2024-06-01')

      await store.insert(
        createEntry({ id: 'a', sessionId: 'session-1', createdAt: new Date('2024-01-01') })
      )
      await store.insert(
        createEntry({ id: 'b', sessionId: 'session-1', createdAt: date })
      )
      await store.insert(
        createEntry({ id: 'c', sessionId: 'session-2', createdAt: date })
      )

      const results = await store.query({
        sessionId: 'session-1',
        since: new Date('2024-03-01'),
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('b')
    })
  })

  describe('get', () => {
    it('returns entry by id', async () => {
      await store.insert(createEntry({ id: 'test-1', content: 'Hello' }))

      const entry = await store.get('test-1')

      expect(entry).not.toBeNull()
      expect(entry?.content).toBe('Hello')
    })

    it('returns null for non-existent id', async () => {
      const entry = await store.get('non-existent')
      expect(entry).toBeNull()
    })
  })

  describe('delete', () => {
    it('deletes entry by id', async () => {
      await store.insert(createEntry({ id: 'test-1' }))

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
    it('returns total entry count', async () => {
      expect(await store.count()).toBe(0)

      await store.insert(createEntry({ id: 'a' }))
      await store.insert(createEntry({ id: 'b' }))
      await store.insert(createEntry({ id: 'c' }))

      expect(await store.count()).toBe(3)
    })

    it('updates after delete', async () => {
      await store.insert(createEntry({ id: 'a' }))
      await store.insert(createEntry({ id: 'b' }))

      await store.delete('a')

      expect(await store.count()).toBe(1)
    })
  })
})
