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
 */
export interface IVectorStore {
  insert(entry: EpisodicEntry): Promise<void>
  search(
    queryEmbedding: number[],
    limit: number,
    minSimilarity?: number
  ): Promise<EpisodicSearchResult[]>
  query(filter: { sessionId?: string; since?: Date }): Promise<EpisodicEntry[]>
  get(id: string): Promise<EpisodicEntry | null>
  delete(id: string): Promise<boolean>
  count(): Promise<number>
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
  private dimensions: number

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

      CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic_entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_episodic_created ON episodic_entries(created_at);
    `)
  }

  /**
   * Insert an episodic entry.
   */
  async insert(entry: EpisodicEntry): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO episodic_entries
      (id, content, embedding, session_id, turn_number, participants, label, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      entry.id,
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
   */
  async search(
    queryEmbedding: number[],
    limit: number,
    minSimilarity: number = 0
  ): Promise<EpisodicSearchResult[]> {
    // Get all entries (brute force for MVP)
    const rows = this.db
      .prepare('SELECT * FROM episodic_entries')
      .all() as any[]

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
   */
  async query(filter: { sessionId?: string; since?: Date }): Promise<EpisodicEntry[]> {
    let sql = 'SELECT * FROM episodic_entries WHERE 1=1'
    const params: any[] = []

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
   */
  async get(id: string): Promise<EpisodicEntry | null> {
    const row = this.db
      .prepare('SELECT * FROM episodic_entries WHERE id = ?')
      .get(id) as any

    if (!row) return null
    return this.rowToEntry(row)
  }

  /**
   * Delete entry by ID.
   */
  async delete(id: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM episodic_entries WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  /**
   * Count total entries.
   */
  async count(): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM episodic_entries')
      .get() as { count: number }
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
