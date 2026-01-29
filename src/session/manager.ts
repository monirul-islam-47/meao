/**
 * Session manager - integrates session persistence with orchestrator
 */

import type { ConversationMessage } from '../provider/types.js'
import type {
  Session,
  SessionStore,
  PersistedMessage,
} from './types.js'
import { secretDetector } from '../security/secrets/index.js'

/**
 * Session manager for persistence and restoration.
 */
export class SessionManager {
  private store: SessionStore
  private currentSession: Session | null = null

  constructor(store: SessionStore) {
    this.store = store
  }

  /**
   * Create a new session.
   */
  async newSession(options: {
    model?: string
    workDir?: string
    title?: string
  } = {}): Promise<Session> {
    this.currentSession = await this.store.create({
      model: options.model,
      workDir: options.workDir,
      title: options.title,
      state: 'active',
    })
    return this.currentSession
  }

  /**
   * Resume an existing session.
   */
  async resumeSession(id: string): Promise<Session | null> {
    const session = await this.store.get(id)
    if (session) {
      // Mark as active
      await this.store.update(id, { state: 'active' })
      session.state = 'active'
      this.currentSession = session
    }
    return session
  }

  /**
   * Pause the current session (e.g., on exit).
   */
  async pauseSession(): Promise<void> {
    if (this.currentSession) {
      await this.store.update(this.currentSession.id, { state: 'paused' })
      this.currentSession.state = 'paused'
    }
  }

  /**
   * Complete the current session.
   */
  async completeSession(): Promise<void> {
    if (this.currentSession) {
      await this.store.update(this.currentSession.id, { state: 'completed' })
      this.currentSession.state = 'completed'
    }
  }

  /**
   * Get the current session.
   */
  getCurrentSession(): Session | null {
    return this.currentSession
  }

  /**
   * Add a user message to the session.
   */
  async addUserMessage(content: string, tokens?: number): Promise<void> {
    if (!this.currentSession) return

    const message: PersistedMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      tokens,
    }

    await this.store.addMessage(this.currentSession.id, message)

    // Update local copy
    this.currentSession.messages.push(message)
    this.currentSession.messageCount++
    if (tokens) {
      this.currentSession.totalTokens = (this.currentSession.totalTokens ?? 0) + tokens
    }
  }

  /**
   * Add an assistant message to the session.
   */
  async addAssistantMessage(
    content: string,
    tokens?: number
  ): Promise<void> {
    if (!this.currentSession) return

    const message: PersistedMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      tokens,
    }

    await this.store.addMessage(this.currentSession.id, message)

    // Update local copy
    this.currentSession.messages.push(message)
    this.currentSession.messageCount++
    if (tokens) {
      this.currentSession.totalTokens = (this.currentSession.totalTokens ?? 0) + tokens
    }
  }

  /**
   * Add a tool result to the session.
   * Content is automatically redacted for secrets.
   */
  async addToolResult(
    toolCallId: string,
    toolName: string,
    content: string,
    tokens?: number
  ): Promise<void> {
    if (!this.currentSession) return

    // Redact secrets before persistence
    const { redacted, findings } = secretDetector.redact(content)

    const message: PersistedMessage = {
      id: crypto.randomUUID(),
      role: 'tool_result',
      content: redacted,
      timestamp: Date.now(),
      tokens,
      toolCallId,
      toolName,
      redacted: findings.length > 0,
    }

    await this.store.addMessage(this.currentSession.id, message)

    // Update local copy
    this.currentSession.messages.push(message)
    this.currentSession.messageCount++
    if (tokens) {
      this.currentSession.totalTokens = (this.currentSession.totalTokens ?? 0) + tokens
    }
  }

  /**
   * Grant an approval for this session.
   */
  async grantApproval(approvalId: string): Promise<void> {
    if (!this.currentSession) return

    const approvals = this.currentSession.grantedApprovals ?? []
    if (!approvals.includes(approvalId)) {
      approvals.push(approvalId)
      await this.store.update(this.currentSession.id, {
        grantedApprovals: approvals,
      })
      this.currentSession.grantedApprovals = approvals
    }
  }

  /**
   * Check if an approval is granted.
   */
  hasApproval(approvalId: string): boolean {
    return this.currentSession?.grantedApprovals?.includes(approvalId) ?? false
  }

  /**
   * Set the session title.
   */
  async setTitle(title: string): Promise<void> {
    if (!this.currentSession) return

    await this.store.update(this.currentSession.id, { title })
    this.currentSession.title = title
  }

  /**
   * Convert persisted messages to conversation format.
   */
  getConversationHistory(): ConversationMessage[] {
    if (!this.currentSession) return []

    return this.currentSession.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))
  }

  /**
   * Get session metadata.
   */
  getSessionMetadata(): {
    id: string
    title?: string
    messageCount: number
    totalTokens?: number
  } | null {
    if (!this.currentSession) return null

    return {
      id: this.currentSession.id,
      title: this.currentSession.title,
      messageCount: this.currentSession.messageCount,
      totalTokens: this.currentSession.totalTokens,
    }
  }

  /**
   * List all sessions.
   */
  async listSessions(options?: {
    state?: 'active' | 'paused' | 'completed'
    limit?: number
  }) {
    return this.store.list(options)
  }
}
