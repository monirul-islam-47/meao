/**
 * Semantic Memory
 *
 * Stores and retrieves structured facts with security controls.
 * Enforces FC-2: Flow control for semantic memory writes.
 *
 * Key features:
 * - Subject-predicate-object triple storage
 * - Flow control enforcement for untrusted/verified content
 * - Confidence scoring and source attribution
 * - Query by subject, predicate, or fact type
 */

import { randomUUID } from 'crypto'
import type { ContentLabel } from '../../security/labels/types.js'
import { canWriteSemanticMemory } from '../../security/flow/control.js'
import { secretDetector } from '../../security/secrets/index.js'
import type { SemanticFact, FactType, MemoryWriteResult } from '../types.js'
import { SqliteSemanticStore, type ISemanticStore, type SemanticQueryFilter } from './store.js'

/**
 * Input for adding a semantic fact.
 */
export interface AddFactInput {
  factType: FactType
  subject: string
  predicate: string
  object: string
  label: ContentLabel
  confidence?: number
  source?: {
    origin: string
    verifiedBy?: string
  }
  metadata?: Record<string, unknown>
  userConfirmed?: boolean
}

/**
 * Semantic Memory class.
 *
 * Manages storage of structured facts with security controls.
 */
export class SemanticMemory {
  private store: ISemanticStore

  constructor(config: { storePath: string }) {
    this.store = new SqliteSemanticStore(config.storePath)
  }

  /**
   * Add a new semantic fact.
   *
   * Enforces FC-2: Flow control for semantic memory writes.
   * - untrusted content is blocked unless userConfirmed=true
   * - verified content requires userConfirmed=true
   * - user/system content is allowed
   *
   * @param input - Fact data
   * @returns Write result with success/failure info
   */
  async add(input: AddFactInput): Promise<MemoryWriteResult> {
    // Check flow control for semantic memory writes
    const decision = canWriteSemanticMemory(input.label)

    if (decision.allowed === false) {
      // Blocked, but can be overridden with user confirmation
      if (decision.canOverride && input.userConfirmed) {
        // User explicitly confirmed, allow the write
      } else {
        return {
          success: false,
          rejected: {
            reason: decision.reason ?? 'Flow control blocked semantic memory write',
            canOverride: decision.canOverride ?? false,
          },
        }
      }
    }

    if (decision.allowed === 'ask' && !input.userConfirmed) {
      // Requires confirmation but not provided
      return {
        success: false,
        rejected: {
          reason: decision.reason ?? 'Semantic memory write requires confirmation',
          canOverride: true,
        },
      }
    }

    const id = randomUUID()
    const now = new Date()

    // Build content from triple for searchability
    let content = `${input.subject} ${input.predicate} ${input.object}`

    // Redact secrets from content (shouldn't happen often for facts, but be safe)
    let metadata = { ...input.metadata }
    const scanResult = secretDetector.scan(content)
    if (scanResult.hasSecrets) {
      const redactionResult = secretDetector.redact(content)
      content = redactionResult.redacted
      metadata.redacted = true
    }

    // Create fact
    const fact: SemanticFact = {
      id,
      type: 'semantic',
      factType: input.factType,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      content,
      confidence: input.confidence ?? 1.0,
      label: input.label,
      source: {
        origin: input.source?.origin ?? 'unknown',
        timestamp: now,
        verifiedBy: input.source?.verifiedBy,
      },
      createdAt: now,
      updatedAt: now,
      metadata,
    }

    // Store fact
    await this.store.insert(fact)

    return {
      success: true,
      entryId: id,
    }
  }

  /**
   * Update an existing fact.
   *
   * Only allows updating confidence, metadata, and verification.
   * Does not allow changing the core triple (subject, predicate, object).
   *
   * @param id - Fact ID
   * @param updates - Fields to update
   * @returns True if updated
   */
  async update(
    id: string,
    updates: {
      confidence?: number
      verifiedBy?: string
      metadata?: Record<string, unknown>
    }
  ): Promise<boolean> {
    const existing = await this.store.get(id)
    if (!existing) return false

    const factUpdates: Partial<Omit<SemanticFact, 'id' | 'type'>> = {}

    if (updates.confidence !== undefined) {
      factUpdates.confidence = updates.confidence
    }

    if (updates.verifiedBy !== undefined) {
      factUpdates.source = {
        ...existing.source,
        verifiedBy: updates.verifiedBy,
      }
    }

    if (updates.metadata !== undefined) {
      factUpdates.metadata = { ...existing.metadata, ...updates.metadata }
    }

    return this.store.update(id, factUpdates)
  }

  /**
   * Get fact by ID.
   *
   * @param id - Fact ID
   * @returns Fact or null if not found
   */
  async get(id: string): Promise<SemanticFact | null> {
    return this.store.get(id)
  }

  /**
   * Delete fact by ID.
   *
   * @param id - Fact ID
   * @returns True if deleted
   */
  async delete(id: string): Promise<boolean> {
    return this.store.delete(id)
  }

  /**
   * Query facts by filter.
   *
   * @param filter - Query filter options
   * @returns Matching facts
   */
  async query(filter: SemanticQueryFilter): Promise<SemanticFact[]> {
    return this.store.query(filter)
  }

  /**
   * Get facts about a subject.
   *
   * @param subject - Subject to query
   * @returns Facts about the subject
   */
  async getBySubject(subject: string): Promise<SemanticFact[]> {
    return this.store.query({ subject })
  }

  /**
   * Get facts by predicate.
   *
   * @param predicate - Predicate to query
   * @returns Facts with the predicate
   */
  async getByPredicate(predicate: string): Promise<SemanticFact[]> {
    return this.store.query({ predicate })
  }

  /**
   * Get facts by type.
   *
   * @param factType - Fact type to query
   * @returns Facts of the given type
   */
  async getByType(factType: FactType): Promise<SemanticFact[]> {
    return this.store.query({ factType })
  }

  /**
   * Get high-confidence facts.
   *
   * @param minConfidence - Minimum confidence threshold (default 0.8)
   * @returns High-confidence facts
   */
  async getHighConfidence(minConfidence: number = 0.8): Promise<SemanticFact[]> {
    return this.store.query({ minConfidence })
  }

  /**
   * Get total fact count.
   */
  async count(): Promise<number> {
    return this.store.count()
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.store.close()
  }
}

// Re-export types and store
export { SqliteSemanticStore } from './store.js'
export type { ISemanticStore, SemanticQueryFilter } from './store.js'
