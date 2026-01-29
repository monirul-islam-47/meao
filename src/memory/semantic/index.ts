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
import { sanitizeForStorage } from '../../security/sanitize/index.js'
import { getAuditLogger, type AuditLogger } from '../../audit/index.js'
import type { SemanticFact, FactType, MemoryWriteResult, LabelPromotion } from '../types.js'
import { SqliteSemanticStore, type ISemanticStore, type SemanticQueryFilter } from './store.js'

/**
 * Input for adding a semantic fact.
 *
 * userId is required for user data isolation (INV-5).
 */
export interface AddFactInput {
  userId: string // Required for user data isolation
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
  private auditLogger: AuditLogger

  constructor(config: { storePath: string; auditLogger?: AuditLogger }) {
    this.store = new SqliteSemanticStore(config.storePath)
    this.auditLogger = config.auditLogger ?? getAuditLogger()
  }

  /**
   * Add a new semantic fact.
   *
   * Enforces FC-2: Flow control for semantic memory writes.
   * - untrusted content is blocked unless userConfirmed=true
   * - verified content requires userConfirmed=true
   * - user/system content is allowed
   *
   * When userConfirmed=true overrides flow control, this creates:
   * - An audit log entry for the trust promotion (per INV-9)
   * - A LabelPromotion record in the fact metadata
   *
   * @param input - Fact data
   * @returns Write result with success/failure info
   */
  async add(input: AddFactInput): Promise<MemoryWriteResult> {
    // Check flow control for semantic memory writes
    const decision = canWriteSemanticMemory(input.label)

    // Track if we're doing a trust promotion
    let trustPromotion: LabelPromotion | undefined

    if (decision.allowed === false) {
      // Blocked, but can be overridden with user confirmation
      if (decision.canOverride && input.userConfirmed) {
        // User explicitly confirmed - this is a trust promotion
        trustPromotion = {
          scope: 'entry',
          originalTrustLevel: input.label.trustLevel,
          promotedTo: 'user', // User vouched for it, promoting to user trust
          reason: 'user_confirmed_as_fact',
          authorizedBy: input.userId,
          timestamp: new Date(),
        }
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

    // If allowed === 'ask' and userConfirmed, also record promotion
    if (decision.allowed === 'ask' && input.userConfirmed && !trustPromotion) {
      trustPromotion = {
        scope: 'entry',
        originalTrustLevel: input.label.trustLevel,
        promotedTo: 'user',
        reason: 'user_confirmed_as_fact',
        authorizedBy: input.userId,
        timestamp: new Date(),
      }
    }

    const id = randomUUID()
    const now = new Date()

    // Build content from triple for searchability
    let content = `${input.subject} ${input.predicate} ${input.object}`

    // Sanitize and redact content for storage
    let metadata: Record<string, unknown> = { ...input.metadata }

    // Step 1: Sanitize to remove instruction-like patterns
    const sanitizeResult = sanitizeForStorage(content)
    if (sanitizeResult.sanitized) {
      content = sanitizeResult.content
      metadata.sanitized = true
      metadata.sanitizedPatterns = sanitizeResult.removedPatterns
    }

    // Step 2: Redact secrets from content (shouldn't happen often for facts, but be safe)
    const scanResult = secretDetector.scan(content)
    if (scanResult.hasSecrets) {
      const redactionResult = secretDetector.redact(content)
      content = redactionResult.redacted
      metadata.redacted = true
    }

    // Step 3: Record trust promotion if applicable
    if (trustPromotion) {
      metadata.labelPromotion = trustPromotion

      // Audit log the trust promotion (INV-9 requirement)
      // Log metadata only, never content (per audit policy)
      await this.auditLogger.log({
        category: 'memory',
        action: 'semantic_memory_write_confirmed',
        severity: 'info',
        userId: input.userId,
        metadata: {
          factId: id,
          factType: input.factType,
          originalTrustLevel: trustPromotion.originalTrustLevel,
          promotedTo: trustPromotion.promotedTo,
          reason: trustPromotion.reason,
          source: input.source?.origin ?? 'unknown',
        },
      })
    }

    // Create fact with potentially promoted label
    const effectiveLabel: ContentLabel = trustPromotion
      ? { ...input.label, trustLevel: trustPromotion.promotedTo }
      : input.label

    const fact: SemanticFact = {
      id,
      type: 'semantic',
      userId: input.userId,
      factType: input.factType,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      content,
      confidence: input.confidence ?? 1.0,
      label: effectiveLabel,
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
   * Enforces user data isolation (INV-5) by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param subject - Subject to query
   * @returns Facts about the subject
   */
  async getBySubject(userId: string, subject: string): Promise<SemanticFact[]> {
    return this.store.query({ userId, subject })
  }

  /**
   * Get facts by predicate.
   *
   * Enforces user data isolation (INV-5) by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param predicate - Predicate to query
   * @returns Facts with the predicate
   */
  async getByPredicate(userId: string, predicate: string): Promise<SemanticFact[]> {
    return this.store.query({ userId, predicate })
  }

  /**
   * Get facts by type.
   *
   * Enforces user data isolation (INV-5) by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param factType - Fact type to query
   * @returns Facts of the given type
   */
  async getByType(userId: string, factType: FactType): Promise<SemanticFact[]> {
    return this.store.query({ userId, factType })
  }

  /**
   * Get high-confidence facts.
   *
   * Enforces user data isolation (INV-5) by requiring userId.
   *
   * @param userId - User ID for data isolation
   * @param minConfidence - Minimum confidence threshold (default 0.8)
   * @returns High-confidence facts
   */
  async getHighConfidence(userId: string, minConfidence: number = 0.8): Promise<SemanticFact[]> {
    return this.store.query({ userId, minConfidence })
  }

  /**
   * Get total fact count for a user.
   *
   * @param userId - User ID for data isolation (optional for global count)
   */
  async count(userId?: string): Promise<number> {
    return this.store.count(userId)
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
