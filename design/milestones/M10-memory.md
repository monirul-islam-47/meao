# Milestone 10: Memory System

**Status:** COMPLETE
**Scope:** Phase 2 (Working + Episodic), Phase 3 (Semantic)
**Dependencies:** M8 (Orchestrator)
**PR:** PR10

---

## Goal

Implement three-tier memory: working (session), episodic (vector similarity), and semantic (structured facts). Memory enables continuity across sessions and personalized responses.

**Spec Reference:** [MEMORY.md](../MEMORY.md)

---

## File Structure

```
src/memory/
├── index.ts                   # Public exports
├── types.ts                   # Memory types
├── working/
│   ├── index.ts               # Session-scoped memory
│   └── compaction.ts          # History summarization
├── episodic/
│   ├── index.ts               # Vector similarity search
│   ├── embeddings.ts          # Embedding generation
│   └── store.ts               # Vector store (sqlite-vss first)
├── semantic/
│   ├── index.ts               # Structured knowledge
│   ├── types.ts               # Fact, preference, entity types
│   ├── store.ts               # Semantic store
│   └── extraction.ts          # Fact extraction from conversations
└── manager.ts                 # Unified memory manager
```

---

## Key Exports

```typescript
// src/memory/index.ts
export { MemoryManager } from './manager'
export { WorkingMemory } from './working'
export { EpisodicMemory } from './episodic'
export { SemanticMemory } from './semantic'
export {
  type MemoryEntry,
  type EpisodicEntry,
  type SemanticFact,
  type MemoryQuery,
  type MemoryWriteResult,
} from './types'
```

---

## Implementation Requirements

### 1. Types (types.ts)

```typescript
import { ContentLabel } from '../security'

export interface MemoryEntry {
  id: string
  type: 'working' | 'episodic' | 'semantic'
  content: string
  label: ContentLabel
  createdAt: Date
  updatedAt: Date
  metadata: Record<string, unknown>
}

export interface EpisodicEntry extends MemoryEntry {
  type: 'episodic'
  embedding: number[]
  sessionId: string
  turnNumber: number
  participants: string[]
}

export interface SemanticFact extends MemoryEntry {
  type: 'semantic'
  factType: 'preference' | 'entity' | 'relationship' | 'instruction'
  subject: string
  predicate: string
  object: string
  confidence: number
  source: {
    origin: string
    timestamp: Date
    verifiedBy?: string  // User ID if manually verified
  }
}

export interface MemoryQuery {
  query: string
  types?: ('working' | 'episodic' | 'semantic')[]
  limit?: number
  minSimilarity?: number
  includeLabels?: ContentLabel[]
}

export interface MemoryWriteResult {
  success: boolean
  entryId?: string
  rejected?: {
    reason: string
    canOverride: boolean
  }
}
```

### 2. Working Memory (working/index.ts)

```typescript
import { Message } from '../provider'
import { ContentLabel, combineLabels } from '../security'

export interface WorkingMemoryConfig {
  maxMessages: number  // Default: 50
  maxTokens: number    // Default: 8000
}

export class WorkingMemory {
  private messages: Message[] = []
  private config: WorkingMemoryConfig
  private combinedLabel: ContentLabel

  constructor(config: WorkingMemoryConfig) {
    this.config = config
    this.combinedLabel = {
      trustLevel: 'verified',
      dataClass: 'internal',
      source: { origin: 'working_memory', timestamp: new Date() },
    }
  }

  add(message: Message, label: ContentLabel): void {
    this.messages.push(message)
    this.combinedLabel = combineLabels(this.combinedLabel, label)

    // Enforce limits
    this.enforceMessageLimit()
    this.enforceTokenLimit()
  }

  getHistory(): Message[] {
    return [...this.messages]
  }

  getLabel(): ContentLabel {
    return this.combinedLabel
  }

  private enforceMessageLimit(): void {
    if (this.messages.length > this.config.maxMessages) {
      // Keep system message + recent messages
      const systemMessages = this.messages.filter(m => m.role === 'system')
      const recentMessages = this.messages
        .filter(m => m.role !== 'system')
        .slice(-this.config.maxMessages + systemMessages.length)
      this.messages = [...systemMessages, ...recentMessages]
    }
  }

  private enforceTokenLimit(): void {
    // Estimate tokens and trim if necessary
    while (this.estimateTokens() > this.config.maxTokens && this.messages.length > 1) {
      // Remove oldest non-system message
      const idx = this.messages.findIndex(m => m.role !== 'system')
      if (idx >= 0) {
        this.messages.splice(idx, 1)
      }
    }
  }

  private estimateTokens(): number {
    // Rough estimate: 4 chars per token
    return this.messages.reduce((sum, m) => sum + m.content.length / 4, 0)
  }

  clear(): void {
    this.messages = []
    this.combinedLabel = {
      trustLevel: 'verified',
      dataClass: 'internal',
      source: { origin: 'working_memory', timestamp: new Date() },
    }
  }
}
```

### 3. Episodic Memory (episodic/index.ts)

**FIX:** Renamed `store()` method to `add()` to avoid collision with `vectorStore` property.

```typescript
import { randomUUID } from 'crypto'
import { EpisodicEntry } from '../types'
import { EmbeddingGenerator } from './embeddings'
import { VectorStore } from './store'

export interface EpisodicMemoryConfig {
  embeddingModel: string
  vectorStorePath: string
  dimensions: number  // Default: 1536 for OpenAI
}

export class EpisodicMemory {
  private embeddings: EmbeddingGenerator
  private vectorStore: VectorStore  // Renamed to avoid collision

  constructor(config: EpisodicMemoryConfig) {
    this.embeddings = new EmbeddingGenerator(config.embeddingModel)
    this.vectorStore = new VectorStore(config.vectorStorePath, config.dimensions)
  }

  // Method renamed from store() to add() to avoid collision
  async add(entry: Omit<EpisodicEntry, 'id' | 'embedding'>): Promise<string> {
    // Generate embedding
    const embedding = await this.embeddings.generate(entry.content)

    const id = randomUUID()
    const fullEntry: EpisodicEntry = {
      ...entry,
      id,
      embedding,
    }

    await this.vectorStore.insert(fullEntry)
    return id
  }

  async search(query: string, limit: number = 10): Promise<EpisodicEntry[]> {
    // Generate query embedding
    const queryEmbedding = await this.embeddings.generate(query)

    // Vector similarity search
    const results = await this.vectorStore.search(queryEmbedding, limit)

    return results
  }

  async getBySession(sessionId: string): Promise<EpisodicEntry[]> {
    return this.vectorStore.query({ sessionId })
  }
}
```

### 4. Embedding Generator (episodic/embeddings.ts)

**FIX:** Added `mock:` prefix for testing. Made generator injectable for flexibility.

```typescript
import { createHash } from 'crypto'

// Interface for injectable embedding generators
export interface IEmbeddingGenerator {
  generate(text: string): Promise<number[]>
}

export class EmbeddingGenerator implements IEmbeddingGenerator {
  private model: string
  private dimensions: number
  private cache = new Map<string, number[]>()

  constructor(model: string, dimensions: number = 1536) {
    this.model = model
    this.dimensions = dimensions
  }

  async generate(text: string): Promise<number[]> {
    // Check cache
    const cacheKey = this.hashText(text)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Generate embedding (provider-specific)
    let embedding: number[]

    if (this.model.startsWith('openai:')) {
      embedding = await this.generateOpenAI(text)
    } else if (this.model.startsWith('local:')) {
      embedding = await this.generateLocal(text)
    } else if (this.model.startsWith('mock:') || this.model === 'mock') {
      // Mock embeddings for testing
      embedding = this.generateMock(text)
    } else {
      throw new Error(`Unknown embedding model: ${this.model}`)
    }

    // Cache and return
    this.cache.set(cacheKey, embedding)
    return embedding
  }

  // Mock embedding: deterministic hash-based vector for testing
  private generateMock(text: string): number[] {
    const hash = this.hashText(text)
    const embedding: number[] = []

    // Generate deterministic embedding from hash
    for (let i = 0; i < this.dimensions; i++) {
      // Use hash chars to generate values between -1 and 1
      const charCode = hash.charCodeAt(i % hash.length)
      embedding.push((charCode / 128) - 1)
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
    return embedding.map(v => v / magnitude)
  }

  private async generateOpenAI(text: string): Promise<number[]> {
    // Call OpenAI embeddings API
    // Implementation depends on OpenAI SDK
    throw new Error('Not implemented')
  }

  private async generateLocal(text: string): Promise<number[]> {
    // Use local embedding model (e.g., sentence-transformers)
    throw new Error('Not implemented')
  }

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }
}

// For testing: allow injecting custom generator into EpisodicMemory
export function createEmbeddingGenerator(
  model: string,
  dimensions: number = 1536
): IEmbeddingGenerator {
  return new EmbeddingGenerator(model, dimensions)
}
```

### 5. Vector Store Interface (episodic/store.ts)

**DESIGN:** Pluggable interface with MVP brute-force implementation.
Phase 2 can add sqlite-vss or hnswlib-node behind this interface.

```typescript
import Database from 'better-sqlite3'
import { EpisodicEntry } from '../types'

// Pluggable interface for vector stores
export interface IVectorStore {
  insert(entry: EpisodicEntry): Promise<void>
  search(queryEmbedding: number[], limit: number): Promise<EpisodicEntry[]>
  query(filter: { sessionId?: string }): Promise<EpisodicEntry[]>
}

/**
 * MVP Implementation: SQLite + brute-force cosine similarity in JS.
 * Sufficient for small datasets (<10k entries).
 * Phase 2: Add sqlite-vss or hnswlib-node for larger datasets.
 */
export class VectorStore implements IVectorStore {
  private db: Database.Database
  private dimensions: number

  constructor(path: string, dimensions: number) {
    this.db = new Database(path)
    this.dimensions = dimensions
    this.initialize()
  }

  private initialize(): void {
    // Create tables (no vector extension needed for MVP)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        label_trust TEXT NOT NULL,
        label_data_class TEXT NOT NULL,
        session_id TEXT,
        turn_number INTEGER,
        created_at TEXT NOT NULL,
        metadata TEXT
      )
    `)

    // Index for session queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_id ON episodic_entries(session_id)
    `)
  }

  async insert(entry: EpisodicEntry): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO episodic_entries (id, content, embedding, label_trust, label_data_class, session_id, turn_number, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      entry.id,
      entry.content,
      JSON.stringify(entry.embedding),  // Store embedding as JSON
      entry.label.trustLevel,
      entry.label.dataClass,
      entry.sessionId,
      entry.turnNumber,
      entry.createdAt.toISOString(),
      JSON.stringify(entry.metadata)
    )
  }

  async search(queryEmbedding: number[], limit: number): Promise<EpisodicEntry[]> {
    // MVP: Brute-force cosine similarity in JS
    // Load all entries and compute similarity
    const allEntries = this.db.prepare(`
      SELECT * FROM episodic_entries
    `).all()

    // Compute similarity scores
    const scored = allEntries.map(row => {
      const entry = this.rowToEntry(row)
      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding)
      return { entry, similarity }
    })

    // Sort by similarity (descending) and take top N
    scored.sort((a, b) => b.similarity - a.similarity)
    return scored.slice(0, limit).map(s => s.entry)
  }

  // Cosine similarity between two vectors
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
    return magnitude === 0 ? 0 : dotProduct / magnitude
  }

  async query(filter: { sessionId?: string }): Promise<EpisodicEntry[]> {
    let sql = 'SELECT * FROM episodic_entries'
    const params: unknown[] = []

    if (filter.sessionId) {
      sql += ' WHERE session_id = ?'
      params.push(filter.sessionId)
    }

    sql += ' ORDER BY created_at DESC'

    const results = this.db.prepare(sql).all(...params)
    return results.map(this.rowToEntry)
  }

  private rowToEntry(row: unknown): EpisodicEntry {
    // Convert database row to EpisodicEntry
    const r = row as Record<string, unknown>
    return {
      id: r.id as string,
      type: 'episodic',
      content: r.content as string,
      // Parse embedding from JSON (stored as TEXT)
      embedding: JSON.parse(r.embedding as string) as number[],
      label: {
        trustLevel: r.label_trust as TrustLevel,
        dataClass: r.label_data_class as DataClass,
        source: { origin: 'episodic_memory', timestamp: new Date() },
      },
      sessionId: r.session_id as string,
      turnNumber: r.turn_number as number,
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.created_at as string),
      metadata: JSON.parse((r.metadata as string) || '{}'),
      participants: [],
    }
  }
}
```

### 6. Semantic Memory (semantic/index.ts)

**Note:** `:memory:` is supported for testing (SQLite in-memory database).

```typescript
import { randomUUID } from 'crypto'
import { SemanticFact, MemoryWriteResult } from '../types'
import { ContentLabel, canWriteSemanticMemory } from '../../security'
import { getAuditLogger } from '../../audit'

export class SemanticMemory {
  private store: SemanticStore
  private audit = getAuditLogger()

  // Accepts ':memory:' for testing or a file path for persistence
  constructor(storePath: string) {
    this.store = new SemanticStore(storePath)  // SQLite supports ':memory:'
  }

  async writeFact(
    fact: Omit<SemanticFact, 'id' | 'createdAt' | 'updatedAt'>,
    label: ContentLabel
  ): Promise<MemoryWriteResult> {
    // Check flow control: can this label write to semantic memory?
    const flowCheck = canWriteSemanticMemory(label)

    if (!flowCheck.allowed) {
      await this.audit.log('memory', 'write_blocked', {
        severity: 'info',
        metadata: {
          factType: fact.factType,
          reason: flowCheck.reason,
          canOverride: flowCheck.canOverride,
        },
      })

      return {
        success: false,
        rejected: {
          reason: flowCheck.reason,
          canOverride: flowCheck.canOverride ?? false,
        },
      }
    }

    // Write the fact
    const id = await this.store.insert({
      ...fact,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await this.audit.log('memory', 'fact_written', {
      metadata: {
        factId: id,
        factType: fact.factType,
        subject: fact.subject,
        predicate: fact.predicate,
        // NOTE: object NOT logged (could contain sensitive info)
      },
    })

    return { success: true, entryId: id }
  }

  async query(subject: string, predicate?: string): Promise<SemanticFact[]> {
    return this.store.query({ subject, predicate })
  }

  async getPreferences(userId: string): Promise<SemanticFact[]> {
    return this.store.query({
      factType: 'preference',
      subject: userId,
    })
  }

  async updateFact(id: string, updates: Partial<SemanticFact>): Promise<boolean> {
    const existing = await this.store.get(id)
    if (!existing) {
      return false
    }

    await this.store.update(id, {
      ...updates,
      updatedAt: new Date(),
    })

    await this.audit.log('memory', 'fact_updated', {
      metadata: { factId: id, factType: existing.factType },
    })

    return true
  }

  async deleteFact(id: string): Promise<boolean> {
    const existing = await this.store.get(id)
    if (!existing) {
      return false
    }

    await this.store.delete(id)

    await this.audit.log('memory', 'fact_deleted', {
      metadata: { factId: id, factType: existing.factType },
    })

    return true
  }
}
```

### 7. Memory Manager (manager.ts)

```typescript
import { WorkingMemory } from './working'
import { EpisodicMemory } from './episodic'
import { SemanticMemory } from './semantic'
import { MemoryQuery, MemoryEntry } from './types'
import { ContentLabel } from '../security'

export interface MemoryManagerConfig {
  working: { maxMessages: number; maxTokens: number }
  episodic: { embeddingModel: string; vectorStorePath: string; dimensions: number }
  semantic: { storePath: string }
}

export class MemoryManager {
  private working: Map<string, WorkingMemory> = new Map()
  private episodic: EpisodicMemory
  private semantic: SemanticMemory

  constructor(config: MemoryManagerConfig) {
    this.episodic = new EpisodicMemory(config.episodic)
    this.semantic = new SemanticMemory(config.semantic.storePath)
  }

  // Working memory is session-scoped
  getWorkingMemory(sessionId: string): WorkingMemory {
    let memory = this.working.get(sessionId)
    if (!memory) {
      memory = new WorkingMemory({ maxMessages: 50, maxTokens: 8000 })
      this.working.set(sessionId, memory)
    }
    return memory
  }

  // Unified query across all tiers
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = []
    const types = query.types ?? ['episodic', 'semantic']

    // Search episodic memory
    if (types.includes('episodic')) {
      const episodicResults = await this.episodic.search(
        query.query,
        query.limit ?? 10
      )
      results.push(...episodicResults)
    }

    // Search semantic memory
    if (types.includes('semantic')) {
      const semanticResults = await this.semantic.query(query.query)
      results.push(...semanticResults)
    }

    // Filter by label if specified
    if (query.includeLabels) {
      return results.filter(entry =>
        query.includeLabels!.some(label =>
          this.labelMatches(entry.label, label)
        )
      )
    }

    return results.slice(0, query.limit ?? 10)
  }

  // Build context for orchestrator
  async buildContextMemory(
    sessionId: string,
    query: string
  ): Promise<{ messages: Message[]; facts: SemanticFact[] }> {
    const working = this.getWorkingMemory(sessionId)

    // Get relevant episodic memories
    const episodic = await this.episodic.search(query, 5)

    // Get relevant facts
    const facts = await this.semantic.query(query)

    return {
      messages: working.getHistory(),
      facts,
    }
  }

  private labelMatches(entry: ContentLabel, filter: ContentLabel): boolean {
    return (
      entry.trustLevel === filter.trustLevel &&
      entry.dataClass === filter.dataClass
    )
  }
}
```

---

## Tests

```
test/memory/
├── working/
│   ├── index.test.ts          # Working memory
│   └── compaction.test.ts     # History summarization
├── episodic/
│   ├── index.test.ts          # Episodic search
│   ├── embeddings.test.ts     # Embedding generation
│   └── store.test.ts          # Vector store
├── semantic/
│   ├── index.test.ts          # Semantic facts
│   ├── store.test.ts          # Semantic store
│   └── extraction.test.ts     # Fact extraction
└── manager.test.ts            # Unified manager
```

### Critical Test Cases

```typescript
// test/memory/working/index.test.ts
describe('WorkingMemory', () => {
  it('enforces message limit', () => {
    const memory = new WorkingMemory({ maxMessages: 5, maxTokens: 10000 })

    for (let i = 0; i < 10; i++) {
      memory.add(
        { role: 'user', content: `Message ${i}` },
        { trustLevel: 'user', dataClass: 'internal', source: { origin: 'test', timestamp: new Date() } }
      )
    }

    expect(memory.getHistory().length).toBeLessThanOrEqual(5)
  })

  it('combines labels using lowest trust', () => {
    const memory = new WorkingMemory({ maxMessages: 50, maxTokens: 10000 })

    memory.add(
      { role: 'user', content: 'Trusted message' },
      { trustLevel: 'verified', dataClass: 'internal', source: { origin: 'test', timestamp: new Date() } }
    )

    memory.add(
      { role: 'assistant', content: 'Untrusted response' },
      { trustLevel: 'untrusted', dataClass: 'internal', source: { origin: 'test', timestamp: new Date() } }
    )

    expect(memory.getLabel().trustLevel).toBe('untrusted')
  })
})

// test/memory/semantic/index.test.ts
describe('SemanticMemory', () => {
  it('blocks untrusted writes', async () => {
    const memory = new SemanticMemory(':memory:')

    const result = await memory.writeFact(
      {
        type: 'semantic',
        factType: 'preference',
        subject: 'user-1',
        predicate: 'prefers',
        object: 'dark mode',
        confidence: 0.9,
        content: 'User prefers dark mode',
        label: { trustLevel: 'untrusted', dataClass: 'internal', source: { origin: 'web', timestamp: new Date() } },
        source: { origin: 'web_fetch', timestamp: new Date() },
        metadata: {},
      },
      { trustLevel: 'untrusted', dataClass: 'internal', source: { origin: 'web', timestamp: new Date() } }
    )

    expect(result.success).toBe(false)
    expect(result.rejected?.reason).toContain('Untrusted content cannot write')
    expect(result.rejected?.canOverride).toBe(true)
  })

  it('allows verified writes', async () => {
    const memory = new SemanticMemory(':memory:')

    const result = await memory.writeFact(
      {
        type: 'semantic',
        factType: 'preference',
        subject: 'user-1',
        predicate: 'prefers',
        object: 'dark mode',
        confidence: 0.9,
        content: 'User prefers dark mode',
        label: { trustLevel: 'verified', dataClass: 'internal', source: { origin: 'user', timestamp: new Date() } },
        source: { origin: 'user_input', timestamp: new Date() },
        metadata: {},
      },
      { trustLevel: 'verified', dataClass: 'internal', source: { origin: 'user', timestamp: new Date() } }
    )

    expect(result.success).toBe(true)
    expect(result.entryId).toBeTruthy()
  })
})

// test/memory/episodic/index.test.ts
describe('EpisodicMemory', () => {
  it('returns similar entries', async () => {
    const memory = new EpisodicMemory({
      embeddingModel: 'mock',  // Uses mock: prefix for deterministic embeddings
      vectorStorePath: ':memory:',
      dimensions: 10,
    })

    // Method renamed from store() to add() to avoid property collision
    await memory.add({
      type: 'episodic',
      content: 'The user prefers TypeScript over JavaScript',
      label: { trustLevel: 'user', dataClass: 'internal', source: { origin: 'test', timestamp: new Date() } },
      sessionId: 'session-1',
      turnNumber: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      participants: ['user-1'],
      metadata: {},
    })

    await memory.add({
      type: 'episodic',
      content: 'The weather today is sunny',
      label: { trustLevel: 'user', dataClass: 'internal', source: { origin: 'test', timestamp: new Date() } },
      sessionId: 'session-1',
      turnNumber: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      participants: ['user-1'],
      metadata: {},
    })

    const results = await memory.search('What programming language does the user prefer?', 1)

    expect(results.length).toBe(1)
    expect(results[0].content).toContain('TypeScript')
  })
})
```

---

## Definition of Done

**Phase 2 (Working + Episodic):**
- [ ] Working memory tracks conversation history
- [ ] Working memory enforces message and token limits
- [ ] Working memory combines labels correctly
- [ ] Episodic memory stores entries with embeddings
- [ ] Episodic memory retrieves by vector similarity
- [ ] All tests pass
- [ ] `pnpm check` passes

**Phase 3 (Semantic):**
- [ ] Semantic memory stores structured facts
- [ ] Semantic memory write rules from MEMORY.md enforced
- [ ] Untrusted content cannot write to semantic memory directly
- [ ] Flow control checks work with canOverride
- [ ] Fact extraction from conversations works
- [ ] All tests pass

---

## Dependencies to Add

```bash
pnpm add better-sqlite3
pnpm add @types/better-sqlite3 -D

# For vector search (Phase 2)
# sqlite-vss requires native compilation
# Alternative: consider using hnswlib-node or other vector libraries
```

---

## Next Milestone

After completing M10, proceed to [M11: Telegram](./M11-telegram.md) (Phase 2).

---

*Last updated: 2026-01-29*
