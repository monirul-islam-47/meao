/**
 * Session persistence types
 */

import type { ContentBlock } from '../provider/types.js'
import type { ContentLabel } from '../security/labels/types.js'

/**
 * Session state.
 */
export type SessionState = 'active' | 'paused' | 'completed' | 'expired'

/**
 * Persisted message in a session.
 */
export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_result'
  content: string | ContentBlock[]
  timestamp: number
  /** Labels for flow control decisions */
  labels?: ContentLabel[]
  /** Token count for this message */
  tokens?: number
  /** Tool call ID if this is a tool result */
  toolCallId?: string
  /** Tool name if this is a tool result */
  toolName?: string
  /** Whether content was redacted */
  redacted?: boolean
}

/**
 * Session metadata.
 */
export interface SessionMetadata {
  id: string
  createdAt: number
  updatedAt: number
  state: SessionState
  /** Human-readable title (auto-generated or user-set) */
  title?: string
  /** Model used for this session */
  model?: string
  /** Working directory for this session */
  workDir?: string
  /** Total messages in session */
  messageCount: number
  /** Total tokens used */
  totalTokens?: number
  /** Granted approvals (for session memory) */
  grantedApprovals?: string[]
}

/**
 * Full session data.
 */
export interface Session extends SessionMetadata {
  messages: PersistedMessage[]
}

/**
 * Options for listing sessions.
 */
export interface ListSessionsOptions {
  /** Filter by state */
  state?: SessionState
  /** Limit number of results */
  limit?: number
  /** Skip first N results */
  offset?: number
  /** Sort order */
  sortBy?: 'createdAt' | 'updatedAt'
  /** Sort direction */
  sortDir?: 'asc' | 'desc'
}

/**
 * Session store interface.
 */
export interface SessionStore {
  /**
   * Create a new session.
   */
  create(metadata: Partial<SessionMetadata>): Promise<Session>

  /**
   * Get a session by ID.
   */
  get(id: string): Promise<Session | null>

  /**
   * Update session metadata.
   */
  update(id: string, metadata: Partial<SessionMetadata>): Promise<void>

  /**
   * Add a message to a session.
   */
  addMessage(id: string, message: Omit<PersistedMessage, 'id'>): Promise<void>

  /**
   * List sessions with filtering/pagination.
   */
  list(options?: ListSessionsOptions): Promise<SessionMetadata[]>

  /**
   * Delete a session.
   */
  delete(id: string): Promise<void>

  /**
   * Check if a session exists.
   */
  exists(id: string): Promise<boolean>
}
