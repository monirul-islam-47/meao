import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryManager } from '../../src/memory/manager.js'
import type { ContentLabel } from '../../src/security/labels/types.js'

function createLabel(overrides: Partial<ContentLabel> = {}): ContentLabel {
  return {
    trustLevel: 'user',
    dataClass: 'internal',
    source: { origin: 'test', timestamp: new Date() },
    ...overrides,
  }
}

describe('MemoryManager', () => {
  let manager: MemoryManager

  afterEach(() => {
    if (manager) {
      manager.close()
    }
  })

  describe('constructor', () => {
    it('creates manager with all memory types', () => {
      manager = new MemoryManager({
        working: { maxMessages: 50, maxTokens: 8000 },
        episodic: { vectorStorePath: ':memory:', embeddingModel: 'mock' },
        semantic: { storePath: ':memory:' },
      })

      expect(manager.getEpisodicMemory()).not.toBeNull()
      expect(manager.getSemanticMemory()).not.toBeNull()
    })

    it('creates manager without episodic memory', () => {
      manager = new MemoryManager({
        episodic: { enabled: false, vectorStorePath: ':memory:' },
        semantic: { storePath: ':memory:' },
      })

      expect(manager.getEpisodicMemory()).toBeNull()
      expect(manager.getSemanticMemory()).not.toBeNull()
    })

    it('creates manager without semantic memory', () => {
      manager = new MemoryManager({
        episodic: { vectorStorePath: ':memory:', embeddingModel: 'mock' },
        semantic: { enabled: false, storePath: ':memory:' },
      })

      expect(manager.getEpisodicMemory()).not.toBeNull()
      expect(manager.getSemanticMemory()).toBeNull()
    })
  })

  describe('working memory', () => {
    beforeEach(() => {
      manager = new MemoryManager({
        working: { maxMessages: 10, maxTokens: 1000 },
        episodic: { enabled: false, vectorStorePath: ':memory:' },
        semantic: { enabled: false, storePath: ':memory:' },
      })
    })

    it('creates working memory for new session', () => {
      const memory = manager.getWorkingMemory('session-1')

      expect(memory).toBeDefined()
      expect(memory.getStats().messageCount).toBe(0)
    })

    it('returns same working memory for same session', () => {
      const memory1 = manager.getWorkingMemory('session-1')
      memory1.add('user', 'Hello', createLabel())

      const memory2 = manager.getWorkingMemory('session-1')
      expect(memory2.getStats().messageCount).toBe(1)
    })

    it('creates separate working memories for different sessions', () => {
      const memory1 = manager.getWorkingMemory('session-1')
      memory1.add('user', 'Hello', createLabel())

      const memory2 = manager.getWorkingMemory('session-2')
      expect(memory2.getStats().messageCount).toBe(0)
    })

    it('clears working memory', () => {
      const memory = manager.getWorkingMemory('session-1')
      memory.add('user', 'Hello', createLabel())

      manager.clearWorkingMemory('session-1')

      expect(manager.getWorkingMemory('session-1').getStats().messageCount).toBe(0)
    })

    it('removes working memory', () => {
      manager.getWorkingMemory('session-1')
      manager.getWorkingMemory('session-2')

      manager.removeWorkingMemory('session-1')

      expect(manager.getActiveSessions()).toEqual(['session-2'])
    })

    it('returns active sessions', () => {
      manager.getWorkingMemory('session-1')
      manager.getWorkingMemory('session-2')
      manager.getWorkingMemory('session-3')

      expect(manager.getActiveSessions()).toHaveLength(3)
      expect(manager.getActiveSessions()).toContain('session-1')
    })

    it('returns session stats', () => {
      const memory = manager.getWorkingMemory('session-1')
      memory.add('system', 'System prompt', createLabel())
      memory.add('user', 'Hello', createLabel())

      const stats = manager.getSessionStats('session-1')

      expect(stats).not.toBeNull()
      expect(stats?.messageCount).toBe(2)
      expect(stats?.systemMessageCount).toBe(1)
    })

    it('returns null stats for non-existent session', () => {
      const stats = manager.getSessionStats('non-existent')
      expect(stats).toBeNull()
    })
  })

  describe('buildContext', () => {
    beforeEach(() => {
      manager = new MemoryManager({
        working: { maxMessages: 50, maxTokens: 8000 },
        episodic: { vectorStorePath: ':memory:', embeddingModel: 'mock' },
        semantic: { storePath: ':memory:' },
      })
    })

    it('returns working memory history', async () => {
      const memory = manager.getWorkingMemory('session-1')
      memory.add('system', 'You are helpful', createLabel())
      memory.add('user', 'Hello', createLabel())

      const context = await manager.buildContext('session-1', 'test query')

      expect(context.workingMessages).toHaveLength(2)
      expect(context.workingMessages[0].role).toBe('system')
    })

    it('returns working memory label', async () => {
      const memory = manager.getWorkingMemory('session-1')
      memory.add('user', 'Hello', createLabel({ trustLevel: 'verified' }))

      const context = await manager.buildContext('session-1', 'test query')

      expect(context.workingLabel.trustLevel).toBe('verified')
    })

    it('returns empty arrays for new session', async () => {
      const context = await manager.buildContext('new-session', 'test query')

      expect(context.workingMessages).toHaveLength(0)
      expect(context.relevantEpisodic).toHaveLength(0)
      expect(context.relevantFacts).toHaveLength(0)
    })

    it('includes relevant episodic memories', async () => {
      // Add episodic entry
      const episodic = manager.getEpisodicMemory()!
      await episodic.add({
        content: 'user: I like TypeScript\nassistant: Great choice!',
        sessionId: 'old-session',
        turnNumber: 1,
        participants: ['user', 'assistant'],
        label: createLabel(),
      })

      // Build context - with mock embeddings, similarity may be low
      const context = await manager.buildContext('new-session', 'TypeScript', {
        episodicMinSimilarity: -1, // Include all
      })

      expect(context.relevantEpisodic.length).toBeGreaterThan(0)
    })

    it('includes relevant semantic facts', async () => {
      // Add semantic fact
      const semantic = manager.getSemanticMemory()!
      await semantic.add({
        factType: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'TypeScript',
        label: createLabel(),
        confidence: 0.9,
      })

      // Build context with query containing relevant words
      const context = await manager.buildContext('session-1', 'What does the user prefer?', {
        semanticMinConfidence: 0.8,
      })

      expect(context.relevantFacts.length).toBeGreaterThan(0)
    })
  })

  describe('saveTurnToEpisodic', () => {
    beforeEach(() => {
      manager = new MemoryManager({
        episodic: { vectorStorePath: ':memory:', embeddingModel: 'mock' },
        semantic: { enabled: false, storePath: ':memory:' },
      })
    })

    it('saves turn to episodic memory', async () => {
      await manager.saveTurnToEpisodic(
        'session-1',
        1,
        [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        createLabel()
      )

      const episodic = manager.getEpisodicMemory()!
      const results = await episodic.getBySession('session-1')

      expect(results).toHaveLength(1)
      expect(results[0].turnNumber).toBe(1)
      expect(results[0].participants).toContain('user')
      expect(results[0].participants).toContain('assistant')
    })

    it('combines messages into content', async () => {
      await manager.saveTurnToEpisodic(
        'session-1',
        1,
        [
          { role: 'user', content: 'What is TypeScript?' },
          { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
        ],
        createLabel()
      )

      const episodic = manager.getEpisodicMemory()!
      const results = await episodic.getBySession('session-1')

      expect(results[0].content).toContain('user: What is TypeScript?')
      expect(results[0].content).toContain('assistant: TypeScript is a typed superset')
    })

    it('does nothing if episodic memory disabled', async () => {
      manager.close()
      manager = new MemoryManager({
        episodic: { enabled: false, vectorStorePath: ':memory:' },
        semantic: { enabled: false, storePath: ':memory:' },
      })

      // Should not throw
      await manager.saveTurnToEpisodic(
        'session-1',
        1,
        [{ role: 'user', content: 'Hello' }],
        createLabel()
      )

      expect(manager.getEpisodicMemory()).toBeNull()
    })
  })

  describe('close', () => {
    it('clears all memory stores', () => {
      manager = new MemoryManager({
        working: { maxMessages: 50, maxTokens: 8000 },
        episodic: { vectorStorePath: ':memory:', embeddingModel: 'mock' },
        semantic: { storePath: ':memory:' },
      })

      manager.getWorkingMemory('session-1')
      manager.getWorkingMemory('session-2')

      manager.close()

      expect(manager.getActiveSessions()).toHaveLength(0)
      expect(manager.getEpisodicMemory()).toBeNull()
      expect(manager.getSemanticMemory()).toBeNull()
    })
  })
})
