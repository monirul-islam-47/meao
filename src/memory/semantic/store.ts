/**
 * Semantic Store
 *
 * SQLite-based storage for semantic facts (subject-predicate-object triples).
 * Supports querying by subject, predicate, or both.
 */

import Database from 'better-sqlite3'
import type { SemanticFact, FactType } from '../types.js'

/**
 * Semantic store interface.
 *
 * All query operations support userId for user data isolation (INV-5).
 */
export interface ISemanticStore {
  insert(fact: SemanticFact): Promise<void>
  update(id: string, updates: Partial<Omit<SemanticFact, 'id' | 'type'>>): Promise<boolean>
  get(id: string): Promise<SemanticFact | null>
  delete(id: string): Promise<boolean>
  query(filter: SemanticQueryFilter): Promise<SemanticFact[]>
  count(userId?: string): Promise<number>
  close(): void
}

/**
 * Filter options for querying semantic facts.
 *
 * userId should be provided for user data isolation (INV-5).
 */
export interface SemanticQueryFilter {
  userId?: string // For user data isolation
  subject?: string
  predicate?: string
  object?: string
  factType?: FactType
  minConfidence?: number
  since?: Date
  limit?: number
}

/**
 * SQLite-based semantic store.
 */
export class SqliteSemanticStore implements ISemanticStore {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.initSchema()
  }

  /**
   * Initialize database schema.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_facts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fact_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_semantic_user ON semantic_facts(user_id);
      CREATE INDEX IF NOT EXISTS idx_semantic_subject ON semantic_facts(subject);
      CREATE INDEX IF NOT EXISTS idx_semantic_predicate ON semantic_facts(predicate);
      CREATE INDEX IF NOT EXISTS idx_semantic_type ON semantic_facts(fact_type);
      CREATE INDEX IF NOT EXISTS idx_semantic_confidence ON semantic_facts(confidence);
      CREATE INDEX IF NOT EXISTS idx_semantic_user_subject ON semantic_facts(user_id, subject);
    `)
  }

  /**
   * Insert a semantic fact.
   */
  async insert(fact: SemanticFact): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO semantic_facts
      (id, user_id, fact_type, subject, predicate, object, content, confidence, label, source, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      fact.id,
      fact.userId,
      fact.factType,
      fact.subject,
      fact.predicate,
      fact.object,
      fact.content,
      fact.confidence,
      JSON.stringify(fact.label),
      JSON.stringify(fact.source),
      fact.createdAt.toISOString(),
      fact.updatedAt.toISOString(),
      JSON.stringify(fact.metadata)
    )
  }

  /**
   * Update an existing fact.
   */
  async update(
    id: string,
    updates: Partial<Omit<SemanticFact, 'id' | 'type'>>
  ): Promise<boolean> {
    const existing = await this.get(id)
    if (!existing) return false

    const updated: SemanticFact = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    await this.insert(updated)
    return true
  }

  /**
   * Get fact by ID.
   */
  async get(id: string): Promise<SemanticFact | null> {
    const row = this.db
      .prepare('SELECT * FROM semantic_facts WHERE id = ?')
      .get(id) as any

    if (!row) return null
    return this.rowToFact(row)
  }

  /**
   * Delete fact by ID.
   */
  async delete(id: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM semantic_facts WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  /**
   * Query facts by filter.
   *
   * When userId is provided, only returns that user's facts (INV-5).
   */
  async query(filter: SemanticQueryFilter): Promise<SemanticFact[]> {
    let sql = 'SELECT * FROM semantic_facts WHERE 1=1'
    const params: any[] = []

    if (filter.userId) {
      sql += ' AND user_id = ?'
      params.push(filter.userId)
    }

    if (filter.subject) {
      sql += ' AND subject = ?'
      params.push(filter.subject)
    }

    if (filter.predicate) {
      sql += ' AND predicate = ?'
      params.push(filter.predicate)
    }

    if (filter.object) {
      sql += ' AND object = ?'
      params.push(filter.object)
    }

    if (filter.factType) {
      sql += ' AND fact_type = ?'
      params.push(filter.factType)
    }

    if (filter.minConfidence !== undefined) {
      sql += ' AND confidence >= ?'
      params.push(filter.minConfidence)
    }

    if (filter.since) {
      sql += ' AND created_at >= ?'
      params.push(filter.since.toISOString())
    }

    sql += ' ORDER BY confidence DESC, updated_at DESC'

    if (filter.limit) {
      sql += ' LIMIT ?'
      params.push(filter.limit)
    }

    const rows = this.db.prepare(sql).all(...params) as any[]
    return rows.map((row) => this.rowToFact(row))
  }

  /**
   * Count facts.
   *
   * When userId is provided, counts only that user's facts (INV-5).
   */
  async count(userId?: string): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM semantic_facts'
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
   * Convert database row to SemanticFact.
   */
  private rowToFact(row: any): SemanticFact {
    const source = JSON.parse(row.source)
    return {
      id: row.id,
      type: 'semantic',
      userId: row.user_id,
      factType: row.fact_type as FactType,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      content: row.content,
      confidence: row.confidence,
      label: JSON.parse(row.label),
      source: {
        ...source,
        timestamp: new Date(source.timestamp),
      },
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: JSON.parse(row.metadata),
    }
  }
}
