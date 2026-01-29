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
    userId: 'test-user-1',
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
      const results = await store.search([0.9, 0.1, 0, 0], 10, 0, 'test-user-1')

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('similar')
    })

    it('respects limit parameter', async () => {
      // Insert multiple entries
      for (let i = 0; i < 10; i++) {
        await store.insert(createEntry({ id: `entry-${i}` }))
      }

      // Use minSimilarity=-1 to include all entries (cosine similarity range is -1 to 1)
      const results = await store.search([0.5, 0.5, 0.5, 0.5], 5, -1, 'test-user-1')
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
      const results = await store.search([1, 0, 0, 0], 10, 0.9, 'test-user-1')

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
      const results = await store.search([1, 0, 0, 0], 10, 0, 'test-user-1')

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

      const results = await store.query({ userId: 'test-user-1', sessionId: 'session-1' })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.sessionId === 'session-1')).toBe(true)
    })

    it('filters by since date', async () => {
      const oldDate = new Date('2024-01-01')
      const newDate = new Date('2024-06-01')

      await store.insert(createEntry({ id: 'old', createdAt: oldDate }))
      await store.insert(createEntry({ id: 'new', createdAt: newDate }))

      const results = await store.query({ userId: 'test-user-1', since: new Date('2024-03-01') })

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
        userId: 'test-user-1',
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

  describe('getOldestIdsByUser', () => {
    it('returns ids of oldest entries for a user', async () => {
      // Insert with explicit timestamps
      await store.insert(
        createEntry({ id: 'old', userId: 'user-1', createdAt: new Date('2024-01-01') })
      )
      await store.insert(
        createEntry({ id: 'mid', userId: 'user-1', createdAt: new Date('2024-06-01') })
      )
      await store.insert(
        createEntry({ id: 'new', userId: 'user-1', createdAt: new Date('2024-12-01') })
      )

      const oldest = await store.getOldestIdsByUser('user-1', 2)

      expect(oldest).toHaveLength(2)
      expect(oldest[0]).toBe('old')
      expect(oldest[1]).toBe('mid')
    })

    it('only returns entries for specified user', async () => {
      await store.insert(
        createEntry({ id: 'user1-old', userId: 'user-1', createdAt: new Date('2024-01-01') })
      )
      await store.insert(
        createEntry({ id: 'user2-old', userId: 'user-2', createdAt: new Date('2024-01-01') })
      )

      const oldest = await store.getOldestIdsByUser('user-1', 10)

      expect(oldest).toHaveLength(1)
      expect(oldest[0]).toBe('user1-old')
    })

    it('throws if userId is missing', async () => {
      await expect(store.getOldestIdsByUser('', 5)).rejects.toThrow('userId is required')
    })
  })

  describe('deleteManyByUser', () => {
    it('deletes multiple entries by ids for a user', async () => {
      await store.insert(createEntry({ id: 'a', userId: 'user-1' }))
      await store.insert(createEntry({ id: 'b', userId: 'user-1' }))
      await store.insert(createEntry({ id: 'c', userId: 'user-1' }))

      const deleted = await store.deleteManyByUser('user-1', ['a', 'c'])

      expect(deleted).toBe(2)
      expect(await store.get('a')).toBeNull()
      expect(await store.get('b')).not.toBeNull()
      expect(await store.get('c')).toBeNull()
    })

    it('only deletes entries belonging to specified user', async () => {
      await store.insert(createEntry({ id: 'user1-entry', userId: 'user-1' }))
      await store.insert(createEntry({ id: 'user2-entry', userId: 'user-2' }))

      // Try to delete user2's entry using user1's scope
      const deleted = await store.deleteManyByUser('user-1', ['user2-entry'])

      expect(deleted).toBe(0) // Should not delete
      expect(await store.get('user2-entry')).not.toBeNull() // Entry still exists
    })

    it('throws if userId is missing', async () => {
      await expect(store.deleteManyByUser('', ['a'])).rejects.toThrow('userId is required')
    })
  })

  describe('INV-5: user data isolation', () => {
    it('search throws if userId is missing', async () => {
      await store.insert(createEntry({ id: 'a' }))

      await expect(store.search([0.5, 0.5, 0.5, 0.5], 10, 0, '')).rejects.toThrow(
        'userId is required'
      )
    })

    it('query throws if userId is missing', async () => {
      await store.insert(createEntry({ id: 'a' }))

      await expect(store.query({ userId: '' })).rejects.toThrow('userId is required')
    })

    it('search only returns entries for specified user', async () => {
      await store.insert(createEntry({ id: 'user1', userId: 'user-1', embedding: [1, 0, 0, 0] }))
      await store.insert(createEntry({ id: 'user2', userId: 'user-2', embedding: [1, 0, 0, 0] }))

      const results = await store.search([1, 0, 0, 0], 10, 0, 'user-1')

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('user1')
    })

    it('query only returns entries for specified user', async () => {
      await store.insert(createEntry({ id: 'user1', userId: 'user-1' }))
      await store.insert(createEntry({ id: 'user2', userId: 'user-2' }))

      const results = await store.query({ userId: 'user-1' })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('user1')
    })

    it('getByUser returns entry only if owned by user', async () => {
      await store.insert(createEntry({ id: 'user1-entry', userId: 'user-1' }))

      // User-1 can get their own entry
      const entry = await store.getByUser('user-1', 'user1-entry')
      expect(entry).not.toBeNull()
      expect(entry?.id).toBe('user1-entry')

      // User-2 cannot get user-1's entry
      const notFound = await store.getByUser('user-2', 'user1-entry')
      expect(notFound).toBeNull()
    })

    it('getByUser throws if userId is missing', async () => {
      await expect(store.getByUser('', 'some-id')).rejects.toThrow('userId is required')
    })

    it('deleteByUser only deletes if owned by user', async () => {
      await store.insert(createEntry({ id: 'user1-entry', userId: 'user-1' }))

      // User-2 cannot delete user-1's entry
      const notDeleted = await store.deleteByUser('user-2', 'user1-entry')
      expect(notDeleted).toBe(false)
      expect(await store.get('user1-entry')).not.toBeNull()

      // User-1 can delete their own entry
      const deleted = await store.deleteByUser('user-1', 'user1-entry')
      expect(deleted).toBe(true)
      expect(await store.get('user1-entry')).toBeNull()
    })

    it('deleteByUser throws if userId is missing', async () => {
      await expect(store.deleteByUser('', 'some-id')).rejects.toThrow('userId is required')
    })
  })
})
