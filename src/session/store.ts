/**
 * JSONL-based session store implementation
 */

import { randomUUID } from 'crypto'
import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import type {
  Session,
  SessionMetadata,
  SessionStore,
  PersistedMessage,
  ListSessionsOptions,
} from './types.js'
import { secretDetector } from '../security/secrets/index.js'

/**
 * JSONL file-based session store.
 *
 * Each session is stored as a JSONL file:
 * - Line 1: Session metadata
 * - Lines 2+: Messages (one per line)
 */
export class JsonlSessionStore implements SessionStore {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  /**
   * Ensure the base directory exists.
   */
  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
  }

  /**
   * Get the path for a session file.
   */
  private getPath(id: string): string {
    return join(this.baseDir, `${id}.jsonl`)
  }

  /**
   * Create a new session.
   */
  async create(metadata: Partial<SessionMetadata> = {}): Promise<Session> {
    await this.ensureDir()

    const now = Date.now()
    const session: Session = {
      id: metadata.id ?? randomUUID(),
      createdAt: metadata.createdAt ?? now,
      updatedAt: metadata.updatedAt ?? now,
      state: metadata.state ?? 'active',
      title: metadata.title,
      model: metadata.model,
      workDir: metadata.workDir,
      messageCount: 0,
      totalTokens: metadata.totalTokens ?? 0,
      grantedApprovals: metadata.grantedApprovals ?? [],
      messages: [],
    }

    await this.writeSession(session)
    return session
  }

  /**
   * Get a session by ID.
   */
  async get(id: string): Promise<Session | null> {
    try {
      const content = await readFile(this.getPath(id), 'utf-8')
      return this.parseSession(content)
    } catch {
      return null
    }
  }

  /**
   * Update session metadata.
   */
  async update(id: string, metadata: Partial<SessionMetadata>): Promise<void> {
    const session = await this.get(id)
    if (!session) {
      throw new Error(`Session ${id} not found`)
    }

    const updated: Session = {
      ...session,
      ...metadata,
      id: session.id, // Don't allow changing ID
      updatedAt: Date.now(),
    }

    await this.writeSession(updated)
  }

  /**
   * Add a message to a session.
   */
  async addMessage(
    id: string,
    message: Omit<PersistedMessage, 'id'>
  ): Promise<void> {
    const session = await this.get(id)
    if (!session) {
      throw new Error(`Session ${id} not found`)
    }

    const persistedMessage: PersistedMessage = {
      id: randomUUID(),
      ...message,
    }

    // Redact secrets from tool results
    if (message.role === 'tool_result' && typeof message.content === 'string') {
      const { redacted, findings } = secretDetector.redact(message.content)
      if (findings.length > 0) {
        persistedMessage.content = redacted
        persistedMessage.redacted = true
      }
    }

    session.messages.push(persistedMessage)
    session.messageCount = session.messages.length
    session.updatedAt = Date.now()
    if (message.tokens) {
      session.totalTokens = (session.totalTokens ?? 0) + message.tokens
    }

    await this.writeSession(session)
  }

  /**
   * List sessions with filtering/pagination.
   */
  async list(options: ListSessionsOptions = {}): Promise<SessionMetadata[]> {
    await this.ensureDir()

    const files = await readdir(this.baseDir)
    const sessionFiles = files.filter(f => f.endsWith('.jsonl'))

    const sessions: SessionMetadata[] = []

    for (const file of sessionFiles) {
      try {
        const content = await readFile(join(this.baseDir, file), 'utf-8')
        const firstLine = content.split('\n')[0]
        if (firstLine) {
          const metadata = JSON.parse(firstLine) as SessionMetadata

          // Apply state filter
          if (options.state && metadata.state !== options.state) {
            continue
          }

          sessions.push(metadata)
        }
      } catch {
        // Skip invalid files
      }
    }

    // Sort
    const sortBy = options.sortBy ?? 'updatedAt'
    const sortDir = options.sortDir ?? 'desc'
    sessions.sort((a, b) => {
      const aVal = a[sortBy] ?? 0
      const bVal = b[sortBy] ?? 0
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })

    // Pagination
    const offset = options.offset ?? 0
    const limit = options.limit ?? sessions.length
    return sessions.slice(offset, offset + limit)
  }

  /**
   * Delete a session.
   */
  async delete(id: string): Promise<void> {
    try {
      await unlink(this.getPath(id))
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Check if a session exists.
   */
  async exists(id: string): Promise<boolean> {
    const session = await this.get(id)
    return session !== null
  }

  /**
   * Write a session to disk.
   */
  private async writeSession(session: Session): Promise<void> {
    const { messages, ...metadata } = session
    const lines = [
      JSON.stringify(metadata),
      ...messages.map(m => JSON.stringify(m)),
    ]
    await writeFile(this.getPath(session.id), lines.join('\n') + '\n')
  }

  /**
   * Parse a session from JSONL content.
   */
  private parseSession(content: string): Session {
    const lines = content.trim().split('\n')
    if (lines.length === 0) {
      throw new Error('Empty session file')
    }

    const metadata = JSON.parse(lines[0]) as SessionMetadata
    const messages = lines.slice(1).map(line => JSON.parse(line) as PersistedMessage)

    return {
      ...metadata,
      messages,
    }
  }
}
