/**
 * Memory System Types
 *
 * Core interfaces for the three-tier memory system:
 * - Working Memory: Session-scoped conversation context
 * - Episodic Memory: Vector similarity search of past conversations
 * - Semantic Memory: Structured facts with security controls
 */

import type { ContentLabel } from '../security/labels/types.js'

/**
 * Memory tier types.
 */
export type MemoryType = 'working' | 'episodic' | 'semantic'

/**
 * Semantic fact types.
 */
export type FactType = 'preference' | 'entity' | 'relationship' | 'instruction'

/**
 * Base memory entry interface.
 */
export interface MemoryEntry {
  id: string
  type: MemoryType
  content: string
  label: ContentLabel
  createdAt: Date
  updatedAt: Date
  metadata: Record<string, unknown>
}

/**
 * Episodic memory entry with vector embedding.
 */
export interface EpisodicEntry extends MemoryEntry {
  type: 'episodic'
  embedding: number[]
  sessionId: string
  turnNumber: number
  participants: string[]
}

/**
 * Semantic memory fact (subject-predicate-object triple).
 */
export interface SemanticFact extends MemoryEntry {
  type: 'semantic'
  factType: FactType
  subject: string
  predicate: string
  object: string
  confidence: number
  source: {
    origin: string
    timestamp: Date
    verifiedBy?: string
  }
}

/**
 * Working memory message (lightweight, session-scoped).
 */
export interface WorkingMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool_result'
  content: string
  label: ContentLabel
  timestamp: Date
  tokens?: number
  redacted?: boolean
}

/**
 * Query parameters for memory retrieval.
 */
export interface MemoryQuery {
  query: string
  types?: MemoryType[]
  limit?: number
  minSimilarity?: number
  sessionId?: string
  since?: Date
}

/**
 * Result from a memory write operation.
 */
export interface MemoryWriteResult {
  success: boolean
  entryId?: string
  rejected?: {
    reason: string
    canOverride: boolean
  }
}

/**
 * Working memory configuration.
 */
export interface WorkingMemoryConfig {
  maxMessages: number
  maxTokens: number
}

/**
 * Episodic memory configuration.
 */
export interface EpisodicMemoryConfig {
  enabled: boolean
  embeddingModel: string
  vectorStorePath: string
  dimensions: number
  maxEntries: number
}

/**
 * Semantic memory configuration.
 */
export interface SemanticMemoryConfig {
  enabled: boolean
  storePath: string
}

/**
 * Full memory manager configuration.
 */
export interface MemoryManagerConfig {
  working: WorkingMemoryConfig
  episodic: EpisodicMemoryConfig
  semantic: SemanticMemoryConfig
}

/**
 * Default working memory configuration.
 */
export const DEFAULT_WORKING_CONFIG: WorkingMemoryConfig = {
  maxMessages: 50,
  maxTokens: 8000,
}

/**
 * Default episodic memory configuration.
 */
export const DEFAULT_EPISODIC_CONFIG: Omit<EpisodicMemoryConfig, 'vectorStorePath'> = {
  enabled: true,
  embeddingModel: 'mock',
  dimensions: 1536,
  maxEntries: 10000,
}

/**
 * Default semantic memory configuration.
 */
export const DEFAULT_SEMANTIC_CONFIG: Omit<SemanticMemoryConfig, 'storePath'> = {
  enabled: true,
}

/**
 * Memory context returned by buildContext().
 */
export interface MemoryContext {
  workingMessages: WorkingMessage[]
  workingLabel: ContentLabel
  relevantEpisodic: EpisodicEntry[]
  relevantFacts: SemanticFact[]
}

/**
 * Stats from working memory.
 */
export interface WorkingMemoryStats {
  messageCount: number
  estimatedTokens: number
  systemMessageCount: number
}

/**
 * Episodic search result with similarity score.
 */
export interface EpisodicSearchResult extends EpisodicEntry {
  similarity: number
}
