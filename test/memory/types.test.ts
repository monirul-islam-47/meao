import { describe, it, expect } from 'vitest'
import type {
  MemoryEntry,
  EpisodicEntry,
  SemanticFact,
  WorkingMessage,
  MemoryQuery,
  MemoryWriteResult,
  WorkingMemoryConfig,
  EpisodicMemoryConfig,
  SemanticMemoryConfig,
  MemoryContext,
  EpisodicSearchResult,
} from '../../src/memory/types.js'
import {
  DEFAULT_WORKING_CONFIG,
  DEFAULT_EPISODIC_CONFIG,
  DEFAULT_SEMANTIC_CONFIG,
} from '../../src/memory/types.js'
import type { ContentLabel } from '../../src/security/labels/types.js'

// Helper to create a valid ContentLabel
function createLabel(overrides: Partial<ContentLabel> = {}): ContentLabel {
  return {
    trustLevel: 'user',
    dataClass: 'internal',
    source: {
      origin: 'test',
      timestamp: new Date(),
    },
    ...overrides,
  }
}

describe('Memory Types', () => {
  describe('MemoryEntry', () => {
    it('can be created with required fields', () => {
      const entry: MemoryEntry = {
        id: 'entry-1',
        type: 'working',
        content: 'Hello world',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      }

      expect(entry.id).toBe('entry-1')
      expect(entry.type).toBe('working')
      expect(entry.content).toBe('Hello world')
    })

    it('supports all memory types', () => {
      const types: MemoryEntry['type'][] = ['working', 'episodic', 'semantic']

      for (const type of types) {
        const entry: MemoryEntry = {
          id: `entry-${type}`,
          type,
          content: 'test',
          label: createLabel(),
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {},
        }
        expect(entry.type).toBe(type)
      }
    })

    it('accepts arbitrary metadata', () => {
      const entry: MemoryEntry = {
        id: 'entry-1',
        type: 'working',
        content: 'test',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          custom: 'value',
          nested: { key: 'value' },
          count: 42,
        },
      }

      expect(entry.metadata.custom).toBe('value')
      expect((entry.metadata.nested as any).key).toBe('value')
      expect(entry.metadata.count).toBe(42)
    })
  })

  describe('EpisodicEntry', () => {
    it('extends MemoryEntry with embedding and session info', () => {
      const entry: EpisodicEntry = {
        id: 'episodic-1',
        type: 'episodic',
        content: 'Discussion about TypeScript',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        embedding: [0.1, 0.2, 0.3, 0.4],
        sessionId: 'session-123',
        turnNumber: 5,
        participants: ['user', 'assistant'],
      }

      expect(entry.type).toBe('episodic')
      expect(entry.embedding).toHaveLength(4)
      expect(entry.sessionId).toBe('session-123')
      expect(entry.turnNumber).toBe(5)
      expect(entry.participants).toContain('user')
    })

    it('requires embedding array', () => {
      const entry: EpisodicEntry = {
        id: 'episodic-1',
        type: 'episodic',
        content: 'test',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        embedding: new Array(1536).fill(0),
        sessionId: 'session-1',
        turnNumber: 1,
        participants: [],
      }

      expect(entry.embedding).toHaveLength(1536)
    })
  })

  describe('SemanticFact', () => {
    it('stores subject-predicate-object triples', () => {
      const fact: SemanticFact = {
        id: 'fact-1',
        type: 'semantic',
        content: 'User prefers dark mode',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        factType: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'dark mode',
        confidence: 0.95,
        source: {
          origin: 'conversation',
          timestamp: new Date(),
        },
      }

      expect(fact.type).toBe('semantic')
      expect(fact.factType).toBe('preference')
      expect(fact.subject).toBe('user')
      expect(fact.predicate).toBe('prefers')
      expect(fact.object).toBe('dark mode')
      expect(fact.confidence).toBe(0.95)
    })

    it('supports all fact types', () => {
      const factTypes: SemanticFact['factType'][] = [
        'preference',
        'entity',
        'relationship',
        'instruction',
      ]

      for (const factType of factTypes) {
        const fact: SemanticFact = {
          id: `fact-${factType}`,
          type: 'semantic',
          content: 'test',
          label: createLabel(),
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {},
          factType,
          subject: 'test',
          predicate: 'is',
          object: 'test',
          confidence: 1.0,
          source: {
            origin: 'test',
            timestamp: new Date(),
          },
        }
        expect(fact.factType).toBe(factType)
      }
    })

    it('supports optional verifiedBy field', () => {
      const fact: SemanticFact = {
        id: 'fact-1',
        type: 'semantic',
        content: 'test',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        factType: 'entity',
        subject: 'project',
        predicate: 'named',
        object: 'meao',
        confidence: 1.0,
        source: {
          origin: 'user_input',
          timestamp: new Date(),
          verifiedBy: 'owner-123',
        },
      }

      expect(fact.source.verifiedBy).toBe('owner-123')
    })

    it('has confidence between 0 and 1', () => {
      const createFact = (confidence: number): SemanticFact => ({
        id: 'fact-1',
        type: 'semantic',
        content: 'test',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        factType: 'preference',
        subject: 'test',
        predicate: 'is',
        object: 'test',
        confidence,
        source: { origin: 'test', timestamp: new Date() },
      })

      expect(createFact(0).confidence).toBe(0)
      expect(createFact(0.5).confidence).toBe(0.5)
      expect(createFact(1).confidence).toBe(1)
    })
  })

  describe('WorkingMessage', () => {
    it('represents a conversation message', () => {
      const message: WorkingMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        label: createLabel(),
        timestamp: new Date(),
      }

      expect(message.role).toBe('user')
      expect(message.content).toBe('Hello')
    })

    it('supports all roles', () => {
      const roles: WorkingMessage['role'][] = ['user', 'assistant', 'system', 'tool_result']

      for (const role of roles) {
        const message: WorkingMessage = {
          id: `msg-${role}`,
          role,
          content: 'test',
          label: createLabel(),
          timestamp: new Date(),
        }
        expect(message.role).toBe(role)
      }
    })

    it('supports optional tokens and redacted fields', () => {
      const message: WorkingMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Response with API key [REDACTED]',
        label: createLabel(),
        timestamp: new Date(),
        tokens: 150,
        redacted: true,
      }

      expect(message.tokens).toBe(150)
      expect(message.redacted).toBe(true)
    })
  })

  describe('MemoryQuery', () => {
    it('requires query string', () => {
      const query: MemoryQuery = {
        query: 'programming preferences',
      }

      expect(query.query).toBe('programming preferences')
    })

    it('supports optional filters', () => {
      const query: MemoryQuery = {
        query: 'TypeScript',
        types: ['episodic', 'semantic'],
        limit: 10,
        minSimilarity: 0.7,
        sessionId: 'session-123',
        since: new Date('2024-01-01'),
      }

      expect(query.types).toContain('episodic')
      expect(query.limit).toBe(10)
      expect(query.minSimilarity).toBe(0.7)
      expect(query.sessionId).toBe('session-123')
    })
  })

  describe('MemoryWriteResult', () => {
    it('indicates successful write', () => {
      const result: MemoryWriteResult = {
        success: true,
        entryId: 'entry-123',
      }

      expect(result.success).toBe(true)
      expect(result.entryId).toBe('entry-123')
    })

    it('indicates rejected write with reason', () => {
      const result: MemoryWriteResult = {
        success: false,
        rejected: {
          reason: 'Untrusted content cannot write to semantic memory',
          canOverride: true,
        },
      }

      expect(result.success).toBe(false)
      expect(result.rejected?.reason).toContain('Untrusted')
      expect(result.rejected?.canOverride).toBe(true)
    })

    it('indicates rejected write that cannot be overridden', () => {
      const result: MemoryWriteResult = {
        success: false,
        rejected: {
          reason: 'Secrets must be redacted first',
          canOverride: false,
        },
      }

      expect(result.rejected?.canOverride).toBe(false)
    })
  })

  describe('Default Configurations', () => {
    it('provides sensible working memory defaults', () => {
      expect(DEFAULT_WORKING_CONFIG.maxMessages).toBe(50)
      expect(DEFAULT_WORKING_CONFIG.maxTokens).toBe(8000)
    })

    it('provides sensible episodic memory defaults', () => {
      expect(DEFAULT_EPISODIC_CONFIG.enabled).toBe(true)
      expect(DEFAULT_EPISODIC_CONFIG.embeddingModel).toBe('mock')
      expect(DEFAULT_EPISODIC_CONFIG.dimensions).toBe(1536)
      expect(DEFAULT_EPISODIC_CONFIG.maxEntries).toBe(10000)
    })

    it('provides sensible semantic memory defaults', () => {
      expect(DEFAULT_SEMANTIC_CONFIG.enabled).toBe(true)
    })
  })

  describe('MemoryContext', () => {
    it('combines all memory tiers for context building', () => {
      const context: MemoryContext = {
        workingMessages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            label: createLabel(),
            timestamp: new Date(),
          },
        ],
        workingLabel: createLabel(),
        relevantEpisodic: [],
        relevantFacts: [],
      }

      expect(context.workingMessages).toHaveLength(1)
      expect(context.relevantEpisodic).toHaveLength(0)
      expect(context.relevantFacts).toHaveLength(0)
    })
  })

  describe('EpisodicSearchResult', () => {
    it('extends EpisodicEntry with similarity score', () => {
      const result: EpisodicSearchResult = {
        id: 'episodic-1',
        type: 'episodic',
        content: 'Discussion about TypeScript',
        label: createLabel(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        embedding: [0.1, 0.2, 0.3],
        sessionId: 'session-123',
        turnNumber: 5,
        participants: ['user'],
        similarity: 0.92,
      }

      expect(result.similarity).toBe(0.92)
    })
  })
})
