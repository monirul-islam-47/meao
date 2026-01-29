/**
 * Memory Manager
 *
 * Unified interface for the three-tier memory system:
 * - Working Memory: Session-scoped conversation context
 * - Episodic Memory: Vector similarity search of past conversations
 * - Semantic Memory: Structured facts with security controls
 *
 * Provides:
 * - Session-scoped working memory management
 * - Context building for LLM conversations
 * - Automatic episodic memory persistence
 */

import type { ContentLabel } from '../security/labels/types.js'
import { WorkingMemory } from './working/index.js'
import { EpisodicMemory } from './episodic/index.js'
import { SemanticMemory } from './semantic/index.js'
import type {
  MemoryManagerConfig,
  MemoryContext,
  WorkingMessage,
  EpisodicEntry,
  SemanticFact,
  DEFAULT_WORKING_CONFIG,
  DEFAULT_EPISODIC_CONFIG,
  DEFAULT_SEMANTIC_CONFIG,
} from './types.js'

/**
 * Configuration for MemoryManager.
 */
export interface MemoryManagerOptions {
  working?: {
    maxMessages?: number
    maxTokens?: number
  }
  episodic?: {
    enabled?: boolean
    embeddingModel?: string
    vectorStorePath: string
    dimensions?: number
    maxEntries?: number
  }
  semantic?: {
    enabled?: boolean
    storePath: string
  }
}

/**
 * Memory Manager class.
 *
 * Orchestrates the three-tier memory system for agent conversations.
 */
export class MemoryManager {
  private workingMemories: Map<string, WorkingMemory> = new Map()
  private episodicMemory: EpisodicMemory | null = null
  private semanticMemory: SemanticMemory | null = null
  private config: MemoryManagerOptions

  constructor(config: MemoryManagerOptions) {
    this.config = config

    // Initialize episodic memory if enabled
    if (config.episodic?.enabled !== false && config.episodic?.vectorStorePath) {
      this.episodicMemory = new EpisodicMemory({
        storePath: config.episodic.vectorStorePath,
        embeddingModel: config.episodic.embeddingModel ?? 'mock',
        dimensions: config.episodic.dimensions,
        maxEntries: config.episodic.maxEntries,
      })
    }

    // Initialize semantic memory if enabled
    if (config.semantic?.enabled !== false && config.semantic?.storePath) {
      this.semanticMemory = new SemanticMemory({
        storePath: config.semantic.storePath,
      })
    }
  }

  /**
   * Get or create working memory for a session.
   *
   * @param sessionId - Session identifier
   * @returns WorkingMemory instance for the session
   */
  getWorkingMemory(sessionId: string): WorkingMemory {
    let memory = this.workingMemories.get(sessionId)
    if (!memory) {
      memory = new WorkingMemory({
        maxMessages: this.config.working?.maxMessages ?? 50,
        maxTokens: this.config.working?.maxTokens ?? 8000,
      })
      this.workingMemories.set(sessionId, memory)
    }
    return memory
  }

  /**
   * Get episodic memory instance.
   *
   * @returns EpisodicMemory or null if disabled
   */
  getEpisodicMemory(): EpisodicMemory | null {
    return this.episodicMemory
  }

  /**
   * Get semantic memory instance.
   *
   * @returns SemanticMemory or null if disabled
   */
  getSemanticMemory(): SemanticMemory | null {
    return this.semanticMemory
  }

  /**
   * Build context for an LLM conversation turn.
   *
   * Retrieves:
   * - Working memory history for the session
   * - Relevant episodic memories based on query similarity
   * - Relevant semantic facts based on query keywords
   *
   * @param sessionId - Session identifier
   * @param userQuery - Current user query
   * @param options - Context building options
   * @returns Memory context for the conversation
   */
  async buildContext(
    sessionId: string,
    userQuery: string,
    options: {
      episodicLimit?: number
      episodicMinSimilarity?: number
      semanticLimit?: number
      semanticMinConfidence?: number
    } = {}
  ): Promise<MemoryContext> {
    const workingMemory = this.getWorkingMemory(sessionId)
    const workingMessages = workingMemory.getHistory()
    const workingLabel = workingMemory.getLabel()

    // Get relevant episodic memories
    let relevantEpisodic: EpisodicEntry[] = []
    if (this.episodicMemory && userQuery) {
      const episodicResults = await this.episodicMemory.search(
        userQuery,
        options.episodicLimit ?? 5,
        options.episodicMinSimilarity ?? 0.5
      )
      // Remove similarity score for context (convert search results to entries)
      relevantEpisodic = episodicResults.map(({ similarity, ...entry }) => entry)
    }

    // Get relevant semantic facts
    let relevantFacts: SemanticFact[] = []
    if (this.semanticMemory && userQuery) {
      // Extract potential subjects from query (simple keyword extraction)
      const words = userQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 2)

      // Query for high-confidence facts
      const facts = await this.semanticMemory.getHighConfidence(
        options.semanticMinConfidence ?? 0.7
      )

      // Filter to facts that might be relevant to the query
      relevantFacts = facts
        .filter((fact) => {
          const factText = `${fact.subject} ${fact.predicate} ${fact.object}`.toLowerCase()
          return words.some((word) => factText.includes(word))
        })
        .slice(0, options.semanticLimit ?? 10)
    }

    return {
      workingMessages,
      workingLabel,
      relevantEpisodic,
      relevantFacts,
    }
  }

  /**
   * Save a conversation turn to episodic memory.
   *
   * @param sessionId - Session identifier
   * @param turnNumber - Turn number in the conversation
   * @param messages - Messages from the turn
   * @param label - Content label for the turn
   */
  async saveTurnToEpisodic(
    sessionId: string,
    turnNumber: number,
    messages: Array<{ role: string; content: string }>,
    label: ContentLabel
  ): Promise<void> {
    if (!this.episodicMemory) return

    // Combine messages into single content for embedding
    const content = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n')

    // Extract participants
    const participants = [...new Set(messages.map((m) => m.role))]

    await this.episodicMemory.add({
      content,
      sessionId,
      turnNumber,
      participants,
      label,
    })
  }

  /**
   * Clear working memory for a session.
   *
   * @param sessionId - Session to clear
   */
  clearWorkingMemory(sessionId: string): void {
    const memory = this.workingMemories.get(sessionId)
    if (memory) {
      memory.clear()
    }
  }

  /**
   * Remove working memory for a session (fully deallocate).
   *
   * @param sessionId - Session to remove
   */
  removeWorkingMemory(sessionId: string): void {
    this.workingMemories.delete(sessionId)
  }

  /**
   * Get all active session IDs.
   *
   * @returns Array of session IDs with working memory
   */
  getActiveSessions(): string[] {
    return Array.from(this.workingMemories.keys())
  }

  /**
   * Get stats for a session's working memory.
   *
   * @param sessionId - Session to query
   * @returns Working memory stats or null if no session
   */
  getSessionStats(sessionId: string): {
    messageCount: number
    estimatedTokens: number
    systemMessageCount: number
  } | null {
    const memory = this.workingMemories.get(sessionId)
    if (!memory) return null
    return memory.getStats()
  }

  /**
   * Close all memory stores.
   *
   * Should be called when shutting down the application.
   */
  close(): void {
    // Clear working memories
    this.workingMemories.clear()

    // Close episodic memory
    if (this.episodicMemory) {
      this.episodicMemory.close()
      this.episodicMemory = null
    }

    // Close semantic memory
    if (this.semanticMemory) {
      this.semanticMemory.close()
      this.semanticMemory = null
    }
  }
}
