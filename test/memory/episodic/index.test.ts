import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EpisodicMemory } from '../../../src/memory/episodic/index.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'

function createLabel(overrides: Partial<ContentLabel> = {}): ContentLabel {
  return {
    trustLevel: 'user',
    dataClass: 'internal',
    source: { origin: 'test', timestamp: new Date() },
    ...overrides,
  }
}

describe('EpisodicMemory', () => {
  let memory: EpisodicMemory

  beforeEach(() => {
    memory = new EpisodicMemory({
      storePath: ':memory:',
      embeddingModel: 'mock',
      dimensions: 64, // Small for faster tests
    })
  })

  afterEach(() => {
    memory.close()
  })

  describe('add', () => {
    it('adds an entry and returns id', async () => {
      const id = await memory.add({
        content: 'Discussion about TypeScript',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user', 'assistant'],
        label: createLabel(),
      })

      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
    })

    it('stores entry that can be retrieved', async () => {
      const id = await memory.add({
        content: 'Hello world',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      const entry = await memory.get(id)

      expect(entry).not.toBeNull()
      expect(entry?.content).toBe('Hello world')
      expect(entry?.sessionId).toBe('session-1')
    })

    it('generates embedding for content', async () => {
      const id = await memory.add({
        content: 'Test content',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      const entry = await memory.get(id)

      expect(entry?.embedding).toBeDefined()
      expect(entry?.embedding.length).toBe(64)
    })

    it('redacts secrets from content', async () => {
      const id = await memory.add({
        content: 'My token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      const entry = await memory.get(id)

      expect(entry?.content).toContain('[REDACTED')
      expect(entry?.metadata.redacted).toBe(true)
    })

    it('preserves label', async () => {
      const label = createLabel({ trustLevel: 'untrusted' })

      const id = await memory.add({
        content: 'Test',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: [],
        label,
      })

      const entry = await memory.get(id)

      expect(entry?.label.trustLevel).toBe('untrusted')
    })

    it('stores metadata', async () => {
      const id = await memory.add({
        content: 'Test',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: [],
        label: createLabel(),
        metadata: { custom: 'value' },
      })

      const entry = await memory.get(id)

      expect(entry?.metadata.custom).toBe('value')
    })
  })

  describe('search', () => {
    it('finds entries by similarity search', async () => {
      // Add entries
      await memory.add({
        content: 'Test entry one',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      await memory.add({
        content: 'Test entry two',
        sessionId: 'session-2',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      await memory.add({
        content: 'Test entry three',
        sessionId: 'session-3',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      // Search returns results (mock embeddings won't be semantically similar,
      // but the search mechanism should work)
      // Use minSimilarity=-1 to include all entries (cosine similarity range is -1 to 1)
      const results = await memory.search('test query', 10, -1)

      // With minSimilarity=-1, we should get all entries
      expect(results.length).toBe(3)
    })

    it('respects limit parameter', async () => {
      // Add multiple entries
      for (let i = 0; i < 10; i++) {
        await memory.add({
          content: `Entry number ${i}`,
          sessionId: 'session-1',
          turnNumber: i,
          participants: ['user'],
          label: createLabel(),
        })
      }

      // Use minSimilarity=-1 to ensure all entries are included
      const results = await memory.search('Entry', 3, -1)

      expect(results).toHaveLength(3)
    })

    it('includes similarity scores', async () => {
      await memory.add({
        content: 'Test content',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      // Use minSimilarity=-1 to ensure we get results with mock embeddings
      const results = await memory.search('Test', 10, -1)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].similarity).toBeDefined()
      expect(typeof results[0].similarity).toBe('number')
      expect(results[0].similarity).toBeGreaterThanOrEqual(-1)
      expect(results[0].similarity).toBeLessThanOrEqual(1)
    })

    it('filters by minSimilarity', async () => {
      await memory.add({
        content: 'Test entry',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      // Get all results first to know what similarity to expect
      const allResults = await memory.search('test query', 10, -1)
      expect(allResults.length).toBe(1)

      // Search with threshold higher than actual similarity should return no results
      const highThreshold = allResults[0].similarity + 0.1
      const filteredResults = await memory.search('test query', 10, highThreshold)

      // All returned results should meet the threshold
      expect(filteredResults.every((r) => r.similarity >= highThreshold)).toBe(true)
    })
  })

  describe('getBySession', () => {
    it('returns entries for a session', async () => {
      await memory.add({
        content: 'Session 1 message 1',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      await memory.add({
        content: 'Session 2 message',
        sessionId: 'session-2',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      await memory.add({
        content: 'Session 1 message 2',
        sessionId: 'session-1',
        turnNumber: 2,
        participants: ['user'],
        label: createLabel(),
      })

      const results = await memory.getBySession('session-1')

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.sessionId === 'session-1')).toBe(true)
    })

    it('returns empty array for non-existent session', async () => {
      const results = await memory.getBySession('non-existent')
      expect(results).toHaveLength(0)
    })
  })

  describe('delete', () => {
    it('deletes entry by id', async () => {
      const id = await memory.add({
        content: 'To be deleted',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      const deleted = await memory.delete(id)

      expect(deleted).toBe(true)
      expect(await memory.get(id)).toBeNull()
    })

    it('returns false for non-existent id', async () => {
      const deleted = await memory.delete('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('count', () => {
    it('returns total entry count', async () => {
      expect(await memory.count()).toBe(0)

      await memory.add({
        content: 'First',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      await memory.add({
        content: 'Second',
        sessionId: 'session-1',
        turnNumber: 2,
        participants: ['user'],
        label: createLabel(),
      })

      expect(await memory.count()).toBe(2)
    })
  })

  describe('getSince', () => {
    it('returns entries since a date', async () => {
      // Note: We can't easily control createdAt in this test
      // since it's set internally. This test just verifies the method works.

      await memory.add({
        content: 'Entry',
        sessionId: 'session-1',
        turnNumber: 1,
        participants: ['user'],
        label: createLabel(),
      })

      // Get entries from a week ago (should include our entry)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const results = await memory.getSince(weekAgo)

      expect(results.length).toBeGreaterThan(0)
    })
  })
})
