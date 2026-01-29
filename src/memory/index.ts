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

// Working Memory (to be added in M10.2)
// export { WorkingMemory } from './working/index.js'

// Episodic Memory (to be added in M10.3)
// export { EpisodicMemory } from './episodic/index.js'
// export { EmbeddingGenerator } from './episodic/embeddings.js'

// Semantic Memory (to be added in M10.4)
// export { SemanticMemory } from './semantic/index.js'

// Memory Manager (to be added in M10.5)
// export { MemoryManager } from './manager.js'
