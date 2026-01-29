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
import { sanitizeForStorage } from '../../security/sanitize/index.js'
import type {
  EpisodicEntry,
  EpisodicSearchResult,
} from '../types.js'
import {
  createEmbeddingGenerator,
  type IEmbeddingGenerator,
} from './embeddings.js'
import { SqliteVectorStore, type IVectorStore } from './store.js'

/**
 * Input for adding an episodic entry.
 *
 * userId is required for user data isolation (INV-5).
 */
export interface AddEpisodicInput {
  userId: string // Required for user data isolation
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

    // Sanitize content for storage (anti-prompt-injection)
    let content = input.content
    let metadata = { ...input.metadata }

    // Step 1: Sanitize to remove instruction-like patterns
    const sanitizeResult = sanitizeForStorage(content)
    if (sanitizeResult.sanitized) {
      content = sanitizeResult.content
      metadata.sanitized = true
      metadata.sanitizedPatterns = sanitizeResult.removedPatterns
    }

    // Step 2: Redact secrets from content
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
      userId: input.userId,
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

    // Enforce max entries limit (per-user to prevent cross-user eviction)
    await this.enforceLimitForUser(input.userId)

    return id
  }

  /**
   * Search for similar entries.
   *
   * Enforces user data isolation (INV-5) by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param query - Text query to search for
   * @param limit - Maximum number of results
   * @param minSimilarity - Minimum similarity threshold (0-1)
   * @returns Similar entries with similarity scores
   */
  async search(
    userId: string,
    query: string,
    limit: number = 5,
    minSimilarity: number = 0.5
  ): Promise<EpisodicSearchResult[]> {
    // Generate embedding for query
    const queryEmbedding = await this.embeddings.generate(query)

    // Search vector store with user scoping
    return this.store.search(queryEmbedding, limit, minSimilarity, userId)
  }

  /**
   * Get entries by session ID.
   *
   * Enforces user data isolation (INV-5) by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param sessionId - Session to query
   * @returns Entries from the session
   */
  async getBySession(userId: string, sessionId: string): Promise<EpisodicEntry[]> {
    return this.store.query({ userId, sessionId })
  }

  /**
   * Get entry by ID with user scope (INV-5).
   *
   * Enforces user data isolation by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param id - Entry ID
   * @returns Entry or null if not found (or not owned by user)
   */
  async get(userId: string, id: string): Promise<EpisodicEntry | null> {
    return this.store.getByUser(userId, id)
  }

  /**
   * Delete entry by ID with user scope (INV-5).
   *
   * Enforces user data isolation by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param id - Entry ID
   * @returns True if deleted
   */
  async delete(userId: string, id: string): Promise<boolean> {
    return this.store.deleteByUser(userId, id)
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
   * Enforces user data isolation (INV-5) by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param since - Start date
   * @returns Entries created after the date
   */
  async getSince(userId: string, since: Date): Promise<EpisodicEntry[]> {
    return this.store.query({ userId, since })
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.store.close()
  }

  /**
   * Enforce max entries limit for a specific user.
   *
   * When a user's entry count exceeds maxEntries, deletes their oldest
   * entries to bring the count back to the limit.
   *
   * Scoped per-user to prevent one noisy user from evicting another's memories.
   *
   * @param userId - User to enforce limit for
   */
  private async enforceLimitForUser(userId: string): Promise<void> {
    // Count only this user's entries
    const count = await this.store.count(userId)
    if (count <= this.maxEntries) return

    // Calculate how many entries need to be removed
    const toRemove = count - this.maxEntries

    // Get IDs of this user's oldest entries
    const oldestIds = await this.store.getOldestIdsByUser(userId, toRemove)
    if (oldestIds.length === 0) return

    // Delete oldest entries (with user scope for safety)
    await this.store.deleteManyByUser(userId, oldestIds)
  }
}

// Re-export related types and functions
export { createEmbeddingGenerator, cosineSimilarity } from './embeddings.js'
export type { IEmbeddingGenerator } from './embeddings.js'
export { SqliteVectorStore } from './store.js'
export type { IVectorStore } from './store.js'
