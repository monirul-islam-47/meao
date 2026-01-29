/**
 * Episodic Memory
 *
 * Stores and retrieves past conversations using vector similarity search.
 * - Generates embeddings for conversation content
 * - Stores in SQLite with JSON-encoded vectors
 * - Retrieves similar entries using cosine similarity
 */

import { randomUUID } from 'crypto'
import type { ContentLabel } from '../../security/labels/types.js'
import { secretDetector } from '../../security/secrets/index.js'
import type {
  EpisodicEntry,
  EpisodicMemoryConfig,
  EpisodicSearchResult,
  DEFAULT_EPISODIC_CONFIG,
} from '../types.js'
import {
  createEmbeddingGenerator,
  type IEmbeddingGenerator,
} from './embeddings.js'
import { SqliteVectorStore, type IVectorStore } from './store.js'

/**
 * Input for adding an episodic entry.
 */
export interface AddEpisodicInput {
  content: string
  sessionId: string
  turnNumber: number
  participants: string[]
  label: ContentLabel
  metadata?: Record<string, unknown>
}

/**
 * Episodic Memory class.
 *
 * Manages long-term storage and retrieval of past conversations
 * using vector embeddings and similarity search.
 */
export class EpisodicMemory {
  private store: IVectorStore
  private embeddings: IEmbeddingGenerator
  private maxEntries: number

  constructor(config: {
    storePath: string
    embeddingModel: string
    dimensions?: number
    maxEntries?: number
  }) {
    this.maxEntries = config.maxEntries ?? 10000

    // Create embedding generator
    this.embeddings = createEmbeddingGenerator({
      model: config.embeddingModel,
      dimensions: config.dimensions,
    })

    // Create vector store
    this.store = new SqliteVectorStore(
      config.storePath,
      this.embeddings.getDimensions()
    )
  }

  /**
   * Add a new episodic entry.
   *
   * @param input - Entry data
   * @returns Entry ID
   */
  async add(input: AddEpisodicInput): Promise<string> {
    const id = randomUUID()
    const now = new Date()

    // Redact secrets from content before storing
    let content = input.content
    let metadata = { ...input.metadata }

    const scanResult = secretDetector.scan(content)
    if (scanResult.hasSecrets) {
      const redactionResult = secretDetector.redact(content)
      content = redactionResult.redacted
      metadata.redacted = true
    }

    // Generate embedding
    const embedding = await this.embeddings.generate(content)

    // Create entry
    const entry: EpisodicEntry = {
      id,
      type: 'episodic',
      content,
      embedding,
      sessionId: input.sessionId,
      turnNumber: input.turnNumber,
      participants: input.participants,
      label: input.label,
      createdAt: now,
      updatedAt: now,
      metadata,
    }

    // Store entry
    await this.store.insert(entry)

    // Enforce max entries limit
    await this.enforceLimit()

    return id
  }

  /**
   * Search for similar entries.
   *
   * @param query - Text query to search for
   * @param limit - Maximum number of results
   * @param minSimilarity - Minimum similarity threshold (0-1)
   * @returns Similar entries with similarity scores
   */
  async search(
    query: string,
    limit: number = 5,
    minSimilarity: number = 0.5
  ): Promise<EpisodicSearchResult[]> {
    // Generate embedding for query
    const queryEmbedding = await this.embeddings.generate(query)

    // Search vector store
    return this.store.search(queryEmbedding, limit, minSimilarity)
  }

  /**
   * Get entries by session ID.
   *
   * @param sessionId - Session to query
   * @returns Entries from the session
   */
  async getBySession(sessionId: string): Promise<EpisodicEntry[]> {
    return this.store.query({ sessionId })
  }

  /**
   * Get entry by ID.
   *
   * @param id - Entry ID
   * @returns Entry or null if not found
   */
  async get(id: string): Promise<EpisodicEntry | null> {
    return this.store.get(id)
  }

  /**
   * Delete entry by ID.
   *
   * @param id - Entry ID
   * @returns True if deleted
   */
  async delete(id: string): Promise<boolean> {
    return this.store.delete(id)
  }

  /**
   * Get total entry count.
   */
  async count(): Promise<number> {
    return this.store.count()
  }

  /**
   * Get entries since a given date.
   *
   * @param since - Start date
   * @returns Entries created after the date
   */
  async getSince(since: Date): Promise<EpisodicEntry[]> {
    return this.store.query({ since })
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.store.close()
  }

  /**
   * Enforce max entries limit by removing oldest entries.
   */
  private async enforceLimit(): Promise<void> {
    const count = await this.store.count()
    if (count <= this.maxEntries) return

    // Get oldest entries to remove
    // For now, we'll just skip enforcement since it requires
    // additional query capability. In production, we'd add
    // a method to get oldest entries and delete them.
    // TODO: Implement proper limit enforcement
  }
}

// Re-export related types and functions
export { createEmbeddingGenerator, cosineSimilarity } from './embeddings.js'
export type { IEmbeddingGenerator } from './embeddings.js'
export { SqliteVectorStore } from './store.js'
export type { IVectorStore } from './store.js'
