/**
 * Working Memory
 *
 * Session-scoped conversation context with:
 * - Message limit enforcement
 * - Token limit enforcement
 * - Label combination (lowest trust, highest sensitivity)
 * - System message preservation during truncation
 * - Secret redaction via FC-3
 */

import { randomUUID } from 'crypto'
import type { ContentLabel, FlowDecision } from '../../security/labels/types.js'
import { combineLabels, propagateLabel } from '../../security/labels/propagation.js'
import { canWriteWorkingMemory } from '../../security/flow/control.js'
import { secretDetector } from '../../security/secrets/index.js'
import type {
  WorkingMessage,
  WorkingMemoryConfig,
  WorkingMemoryStats,
} from '../types.js'
import { DEFAULT_WORKING_CONFIG } from '../types.js'

/**
 * Result of adding a message to working memory.
 */
export interface AddMessageResult {
  success: boolean
  messageId?: string
  redacted?: boolean
  flowDecision?: FlowDecision
}

/**
 * Working Memory class.
 *
 * Manages session-scoped conversation history with:
 * - Message and token limits
 * - Label combination for taint tracking
 * - Flow control enforcement (FC-3)
 * - Secret redaction
 */
export class WorkingMemory {
  private messages: WorkingMessage[] = []
  private config: WorkingMemoryConfig
  private combinedLabel: ContentLabel | null = null

  constructor(config: Partial<WorkingMemoryConfig> = {}) {
    this.config = { ...DEFAULT_WORKING_CONFIG, ...config }
  }

  /**
   * Add a message to working memory.
   *
   * Enforces FC-3: Secrets must be redacted before storage.
   * Combines labels to track content provenance.
   */
  add(
    role: WorkingMessage['role'],
    content: string,
    label: ContentLabel
  ): AddMessageResult {
    // Check flow control (FC-3)
    const flowDecision = canWriteWorkingMemory(label)
    if (!flowDecision.allowed) {
      return {
        success: false,
        flowDecision,
      }
    }

    // Redact secrets if present
    let finalContent = content
    let redacted = false

    if (role !== 'system') {
      const scanResult = secretDetector.scan(content)
      if (scanResult.hasSecrets) {
        const redactionResult = secretDetector.redact(content)
        finalContent = redactionResult.redacted
        redacted = true
      }
    }

    // Create message
    const message: WorkingMessage = {
      id: randomUUID(),
      role,
      content: finalContent,
      label,
      timestamp: new Date(),
      tokens: this.estimateTokens(finalContent),
      redacted,
    }

    // Add message
    this.messages.push(message)

    // Update combined label
    if (this.combinedLabel === null) {
      this.combinedLabel = label
    } else {
      this.combinedLabel = combineLabels(this.combinedLabel, label)
    }

    // Enforce limits
    this.enforceMessageLimit()
    this.enforceTokenLimit()

    return {
      success: true,
      messageId: message.id,
      redacted,
    }
  }

  /**
   * Get all messages in working memory.
   */
  getHistory(): WorkingMessage[] {
    return [...this.messages]
  }

  /**
   * Get messages formatted for provider (role + content).
   */
  getMessagesForProvider(): Array<{ role: string; content: string }> {
    return this.messages.map((m) => ({
      role: m.role === 'tool_result' ? 'user' : m.role,
      content: m.content,
    }))
  }

  /**
   * Get the combined label for all content in working memory.
   */
  getLabel(): ContentLabel {
    if (this.combinedLabel === null) {
      return {
        trustLevel: 'system',
        dataClass: 'internal',
        source: { origin: 'working_memory:empty', timestamp: new Date() },
      }
    }
    return this.combinedLabel
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = []
    this.combinedLabel = null
  }

  /**
   * Get statistics about working memory.
   */
  getStats(): WorkingMemoryStats {
    const systemMessageCount = this.messages.filter(
      (m) => m.role === 'system'
    ).length

    return {
      messageCount: this.messages.length,
      estimatedTokens: this.getTotalTokens(),
      systemMessageCount,
    }
  }

  /**
   * Get the last N messages.
   */
  getRecent(n: number): WorkingMessage[] {
    return this.messages.slice(-n)
  }

  /**
   * Find messages by role.
   */
  findByRole(role: WorkingMessage['role']): WorkingMessage[] {
    return this.messages.filter((m) => m.role === role)
  }

  /**
   * Estimate tokens for a piece of content.
   * Uses a simple heuristic: ~4 characters per token.
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4)
  }

  /**
   * Get total estimated tokens.
   */
  private getTotalTokens(): number {
    return this.messages.reduce((sum, m) => sum + (m.tokens ?? 0), 0)
  }

  /**
   * Enforce message limit by removing oldest non-system messages.
   */
  private enforceMessageLimit(): void {
    while (this.messages.length > this.config.maxMessages) {
      // Find first non-system message to remove
      const indexToRemove = this.messages.findIndex((m) => m.role !== 'system')
      if (indexToRemove === -1) {
        // All messages are system messages - remove oldest
        this.messages.shift()
      } else {
        this.messages.splice(indexToRemove, 1)
      }
    }
  }

  /**
   * Enforce token limit by removing oldest non-system messages.
   */
  private enforceTokenLimit(): void {
    while (this.getTotalTokens() > this.config.maxTokens) {
      // Find first non-system message to remove
      const indexToRemove = this.messages.findIndex((m) => m.role !== 'system')
      if (indexToRemove === -1) {
        // All messages are system messages - remove oldest
        this.messages.shift()
      } else {
        this.messages.splice(indexToRemove, 1)
      }

      // Safety: stop if we've removed all messages
      if (this.messages.length === 0) break
    }
  }
}
