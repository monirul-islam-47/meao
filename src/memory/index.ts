/**
 * Memory System
 *
 * Three-tier memory for the meao agent:
 * - Working Memory: Session-scoped conversation context
 * - Episodic Memory: Vector similarity search of past conversations
 * - Semantic Memory: Structured facts with security controls
 */

// Types
export type {
  MemoryType,
  FactType,
  MemoryEntry,
  EpisodicEntry,
  SemanticFact,
  WorkingMessage,
  MemoryQuery,
  MemoryWriteResult,
  WorkingMemoryConfig,
  EpisodicMemoryConfig,
  SemanticMemoryConfig,
  MemoryManagerConfig,
  MemoryContext,
  WorkingMemoryStats,
  EpisodicSearchResult,
} from './types.js'

export {
  DEFAULT_WORKING_CONFIG,
  DEFAULT_EPISODIC_CONFIG,
  DEFAULT_SEMANTIC_CONFIG,
} from './types.js'

// Working Memory
export { WorkingMemory, type AddMessageResult } from './working/index.js'
export { compactMessages, estimateSavings, type CompactionStrategy, type CompactionOptions } from './working/compaction.js'

// Episodic Memory
export {
  EpisodicMemory,
  createEmbeddingGenerator,
  cosineSimilarity,
  SqliteVectorStore,
  type IEmbeddingGenerator,
  type IVectorStore,
  type AddEpisodicInput,
} from './episodic/index.js'

// Semantic Memory
export {
  SemanticMemory,
  SqliteSemanticStore,
  type AddFactInput,
  type ISemanticStore,
  type SemanticQueryFilter,
} from './semantic/index.js'
export {
  extractFacts,
  validateFact,
  type ExtractedFact,
  type ExtractionConfig,
  DEFAULT_EXTRACTION_CONFIG,
} from './semantic/extraction.js'

// Memory Manager
export { MemoryManager, type MemoryManagerOptions } from './manager.js'
