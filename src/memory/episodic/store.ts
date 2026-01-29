/**
 * Vector Store
 *
 * SQLite-based vector storage with brute-force cosine similarity search.
 * Sufficient for <10k entries; can be upgraded to sqlite-vss or hnswlib later.
 */

import Database from 'better-sqlite3'
import type { EpisodicEntry, EpisodicSearchResult } from '../types.js'
import { cosineSimilarity } from './embeddings.js'

/**
 * Vector store interface.
 *
 * All operations that return data require userId for user isolation (INV-5).
 * Operations that query multiple entries MUST have userId to prevent cross-user leaks.
 */
export interface IVectorStore {
  insert(entry: EpisodicEntry): Promise<void>
  search(
    queryEmbedding: number[],
    limit: number,
    minSimilarity: number,
    userId: string // Required for INV-5
  ): Promise<EpisodicSearchResult[]>
  query(filter: { userId: string; sessionId?: string; since?: Date }): Promise<EpisodicEntry[]> // userId required
  get(id: string): Promise<EpisodicEntry | null>
  getByUser(userId: string, id: string): Promise<EpisodicEntry | null> // INV-5: User-scoped get
  delete(id: string): Promise<boolean>
  deleteByUser(userId: string, id: string): Promise<boolean> // INV-5: User-scoped delete
  deleteMany(ids: string[]): Promise<number>
  deleteManyByUser(userId: string, ids: string[]): Promise<number> // Scoped delete for retention
  count(userId?: string): Promise<number>
  getOldestIdsByUser(userId: string, limit: number): Promise<string[]> // Scoped for retention
  close(): void
}

/**
 * SQLite-based vector store.
 *
 * Stores embeddings as JSON strings and performs brute-force
 * cosine similarity search. Suitable for <10k entries.
 */
export class SqliteVectorStore implements IVectorStore {
  private db: Database.Database
  // Store dimensions for future use (e.g., validation)
  readonly dimensions: number

  constructor(path: string, dimensions: number = 1536) {
    this.dimensions = dimensions
    this.db = new Database(path)
    this.initSchema()
  }

  /**
   * Initialize database schema.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        participants TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_episodic_user ON episodic_entries(user_id);
      CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic_entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_episodic_created ON episodic_entries(created_at);
      CREATE INDEX IF NOT EXISTS idx_episodic_user_session ON episodic_entries(user_id, session_id);
    `)
  }

  /**
   * Insert an episodic entry.
   */
  async insert(entry: EpisodicEntry): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO episodic_entries
      (id, user_id, content, embedding, session_id, turn_number, participants, label, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      entry.id,
      entry.userId,
      entry.content,
      JSON.stringify(entry.embedding),
      entry.sessionId,
      entry.turnNumber,
      JSON.stringify(entry.participants),
      JSON.stringify(entry.label),
      entry.createdAt.toISOString(),
      entry.updatedAt.toISOString(),
      JSON.stringify(entry.metadata)
    )
  }

  /**
   * Search for similar entries using brute-force cosine similarity.
   *
   * userId is REQUIRED to enforce user data isolation (INV-5).
   * Throws if userId is missing or empty.
   */
  async search(
    queryEmbedding: number[],
    limit: number,
    minSimilarity: number = 0,
    userId: string
  ): Promise<EpisodicSearchResult[]> {
    // INV-5: Enforce user data isolation - reject if no userId
    if (!userId || userId.trim() === '') {
      throw new Error('userId is required for episodic search (INV-5: user data isolation)')
    }

    // Get entries filtered by userId
    const sql = 'SELECT * FROM episodic_entries WHERE user_id = ?'
    const rows = this.db.prepare(sql).all(userId) as any[]

    // Calculate similarities
    const results: EpisodicSearchResult[] = []

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[]
      const similarity = cosineSimilarity(queryEmbedding, embedding)

      if (similarity >= minSimilarity) {
        results.push({
          ...this.rowToEntry(row),
          similarity,
        })
      }
    }

    // Sort by similarity (descending) and limit
    results.sort((a, b) => b.similarity - a.similarity)
    return results.slice(0, limit)
  }

  /**
   * Query entries by filter.
   *
   * userId is REQUIRED to enforce user data isolation (INV-5).
   * Throws if userId is missing or empty.
   */
  async query(filter: { userId: string; sessionId?: string; since?: Date }): Promise<EpisodicEntry[]> {
    // INV-5: Enforce user data isolation - reject if no userId
    if (!filter.userId || filter.userId.trim() === '') {
      throw new Error('userId is required for episodic query (INV-5: user data isolation)')
    }

    let sql = 'SELECT * FROM episodic_entries WHERE user_id = ?'
    const params: any[] = [filter.userId]

    if (filter.sessionId) {
      sql += ' AND session_id = ?'
      params.push(filter.sessionId)
    }

    if (filter.since) {
      sql += ' AND created_at >= ?'
      params.push(filter.since.toISOString())
    }

    sql += ' ORDER BY created_at DESC'

    const rows = this.db.prepare(sql).all(...params) as any[]
    return rows.map((row) => this.rowToEntry(row))
  }

  /**
   * Get entry by ID.
   *
   * WARNING: Not user-scoped. Use getByUser() for user data isolation (INV-5).
   */
  async get(id: string): Promise<EpisodicEntry | null> {
    const row = this.db
      .prepare('SELECT * FROM episodic_entries WHERE id = ?')
      .get(id) as any

    if (!row) return null
    return this.rowToEntry(row)
  }

  /**
   * Get entry by ID with user scope (INV-5).
   *
   * Only returns the entry if it belongs to the specified user.
   */
  async getByUser(userId: string, id: string): Promise<EpisodicEntry | null> {
    if (!userId || userId.trim() === '') {
      throw new Error('userId is required for getByUser (INV-5: user data isolation)')
    }

    const row = this.db
      .prepare('SELECT * FROM episodic_entries WHERE id = ? AND user_id = ?')
      .get(id, userId) as any

    if (!row) return null
    return this.rowToEntry(row)
  }

  /**
   * Delete entry by ID.
   *
   * WARNING: Not user-scoped. Use deleteByUser() for user data isolation (INV-5).
   */
  async delete(id: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM episodic_entries WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  /**
   * Delete entry by ID with user scope (INV-5).
   *
   * Only deletes the entry if it belongs to the specified user.
   */
  async deleteByUser(userId: string, id: string): Promise<boolean> {
    if (!userId || userId.trim() === '') {
      throw new Error('userId is required for deleteByUser (INV-5: user data isolation)')
    }

    const result = this.db
      .prepare('DELETE FROM episodic_entries WHERE id = ? AND user_id = ?')
      .run(id, userId)
    return result.changes > 0
  }

  /**
   * Delete multiple entries by IDs.
   */
  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0

    // Use transaction for bulk delete
    const deleteStmt = this.db.prepare('DELETE FROM episodic_entries WHERE id = ?')
    const deleteAll = this.db.transaction((idsToDelete: string[]) => {
      let deleted = 0
      for (const id of idsToDelete) {
        const result = deleteStmt.run(id)
        deleted += result.changes
      }
      return deleted
    })

    return deleteAll(ids)
  }

  /**
   * Get IDs of oldest entries for a specific user (by created_at).
   *
   * Scoped by userId for per-user retention enforcement.
   */
  async getOldestIdsByUser(userId: string, limit: number): Promise<string[]> {
    if (!userId || userId.trim() === '') {
      throw new Error('userId is required for getOldestIdsByUser (INV-5: user data isolation)')
    }

    const rows = this.db
      .prepare('SELECT id FROM episodic_entries WHERE user_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(userId, limit) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  /**
   * Delete multiple entries by IDs, scoped to a specific user.
   *
   * Only deletes entries belonging to the specified user (safety check).
   */
  async deleteManyByUser(userId: string, ids: string[]): Promise<number> {
    if (!userId || userId.trim() === '') {
      throw new Error('userId is required for deleteManyByUser (INV-5: user data isolation)')
    }
    if (ids.length === 0) return 0

    // Use transaction for bulk delete, with user scope for safety
    const deleteStmt = this.db.prepare('DELETE FROM episodic_entries WHERE id = ? AND user_id = ?')
    const deleteAll = this.db.transaction((idsToDelete: string[], uid: string) => {
      let deleted = 0
      for (const id of idsToDelete) {
        const result = deleteStmt.run(id, uid)
        deleted += result.changes
      }
      return deleted
    })

    return deleteAll(ids, userId)
  }

  /**
   * Count entries.
   *
   * When userId is provided, counts only that user's entries (INV-5).
   */
  async count(userId?: string): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM episodic_entries'
    const params: string[] = []

    if (userId) {
      sql += ' WHERE user_id = ?'
      params.push(userId)
    }

    const row = this.db.prepare(sql).get(...params) as { count: number }
    return row.count
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.db.close()
  }

  /**
   * Convert database row to EpisodicEntry.
   */
  private rowToEntry(row: any): EpisodicEntry {
    return {
      id: row.id,
      type: 'episodic',
      userId: row.user_id,
      content: row.content,
      embedding: JSON.parse(row.embedding),
      sessionId: row.session_id,
      turnNumber: row.turn_number,
      participants: JSON.parse(row.participants),
      label: JSON.parse(row.label),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: JSON.parse(row.metadata),
    }
  }
}
