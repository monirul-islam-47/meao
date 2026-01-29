import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, readFile, readdir } from 'fs/promises'
import path from 'path'
import os from 'os'
import { JsonlAuditStore } from '../../src/audit/store/jsonl.js'
import type { AuditEntry } from '../../src/audit/schema.js'

describe('JsonlAuditStore', () => {
  let testDir: string
  let store: JsonlAuditStore

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `meao-audit-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    store = new JsonlAuditStore(testDir)
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  const createEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
    id: `test-${Date.now()}`,
    timestamp: new Date(),
    category: 'tool',
    action: 'execute',
    severity: 'info',
    ...overrides,
  })

  describe('append', () => {
    it('creates audit directory if it does not exist', async () => {
      const newDir = path.join(testDir, 'new-audit')
      const newStore = new JsonlAuditStore(newDir)

      await newStore.append(createEntry())

      const files = await readdir(newDir)
      expect(files.length).toBeGreaterThan(0)
    })

    it('writes entry to daily file', async () => {
      const entry = createEntry({ id: 'unique-test-id' })
      await store.append(entry)

      const files = await readdir(testDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.jsonl$/)

      const content = await readFile(path.join(testDir, files[0]), 'utf-8')
      expect(content).toContain('unique-test-id')
    })

    it('appends multiple entries to same file on same day', async () => {
      const entry1 = createEntry({ id: 'entry-1' })
      const entry2 = createEntry({ id: 'entry-2' })

      await store.append(entry1)
      await store.append(entry2)

      const files = await readdir(testDir)
      expect(files.length).toBe(1)

      const content = await readFile(path.join(testDir, files[0]), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines.length).toBe(2)
      expect(content).toContain('entry-1')
      expect(content).toContain('entry-2')
    })

    it('sanitizes entries before writing', async () => {
      const entry = createEntry({
        metadata: {
          message: { content: 'SENSITIVE_DATA', role: 'user' },
          safeField: 'safe',
        },
      })

      await store.append(entry)

      const files = await readdir(testDir)
      const content = await readFile(path.join(testDir, files[0]), 'utf-8')

      expect(content).not.toContain('SENSITIVE_DATA')
      expect(content).toContain('safeField')
      expect(content).toContain('safe')
    })

    it('writes to different files for different days', async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      const entry1 = createEntry({
        id: 'yesterday-entry',
        timestamp: yesterday,
      })
      const entry2 = createEntry({
        id: 'today-entry',
        timestamp: new Date(),
      })

      await store.append(entry1)
      await store.append(entry2)

      const files = await readdir(testDir)
      expect(files.length).toBe(2)
    })
  })

  describe('query', () => {
    it('returns empty array when no files exist', async () => {
      const results = await store.query({})
      expect(results).toEqual([])
    })

    it('returns all entries when no filter specified', async () => {
      await store.append(createEntry({ id: 'entry-1' }))
      await store.append(createEntry({ id: 'entry-2' }))
      await store.append(createEntry({ id: 'entry-3' }))

      const results = await store.query({})
      expect(results.length).toBe(3)
    })

    it('filters by category', async () => {
      await store.append(createEntry({ id: 'tool-1', category: 'tool' }))
      await store.append(createEntry({ id: 'auth-1', category: 'auth' }))
      await store.append(createEntry({ id: 'tool-2', category: 'tool' }))

      const results = await store.query({ category: 'tool' })
      expect(results.length).toBe(2)
      expect(results.every((e) => e.category === 'tool')).toBe(true)
    })

    it('filters by action', async () => {
      await store.append(createEntry({ id: 'exec-1', action: 'execute' }))
      await store.append(createEntry({ id: 'read-1', action: 'read' }))
      await store.append(createEntry({ id: 'exec-2', action: 'execute' }))

      const results = await store.query({ action: 'read' })
      expect(results.length).toBe(1)
      expect(results[0].action).toBe('read')
    })

    it('filters by severity', async () => {
      await store.append(createEntry({ id: 'info-1', severity: 'info' }))
      await store.append(createEntry({ id: 'warning-1', severity: 'warning' }))
      await store.append(createEntry({ id: 'info-2', severity: 'info' }))

      const results = await store.query({ severity: 'warning' })
      expect(results.length).toBe(1)
      expect(results[0].severity).toBe('warning')
    })

    it('respects limit', async () => {
      await store.append(createEntry({ id: 'entry-1' }))
      await store.append(createEntry({ id: 'entry-2' }))
      await store.append(createEntry({ id: 'entry-3' }))

      const results = await store.query({ limit: 2 })
      expect(results.length).toBe(2)
    })

    it('filters by since date', async () => {
      const now = new Date()
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      const twoDaysAgo = new Date(now)
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

      await store.append(createEntry({ id: 'old', timestamp: twoDaysAgo }))
      await store.append(createEntry({ id: 'yesterday', timestamp: yesterday }))
      await store.append(createEntry({ id: 'today', timestamp: now }))

      const results = await store.query({ since: yesterday })
      expect(results.length).toBe(2)
      expect(results.some((e) => e.id === 'old')).toBe(false)
    })

    it('filters by until date', async () => {
      const now = new Date()
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)

      await store.append(createEntry({ id: 'yesterday', timestamp: yesterday }))
      await store.append(createEntry({ id: 'today', timestamp: now }))

      const results = await store.query({ until: yesterday })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('yesterday')
    })

    it('combines multiple filters', async () => {
      await store.append(
        createEntry({ id: 'match', category: 'tool', severity: 'warning' })
      )
      await store.append(
        createEntry({ id: 'wrong-cat', category: 'auth', severity: 'warning' })
      )
      await store.append(
        createEntry({ id: 'wrong-sev', category: 'tool', severity: 'info' })
      )

      const results = await store.query({
        category: 'tool',
        severity: 'warning',
      })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('match')
    })

    it('parses dates from JSON correctly', async () => {
      const timestamp = new Date('2024-06-15T10:30:00Z')
      await store.append(createEntry({ id: 'dated', timestamp }))

      const results = await store.query({})
      expect(results[0].timestamp).toBeInstanceOf(Date)
      expect(results[0].timestamp.toISOString()).toBe(timestamp.toISOString())
    })
  })

  describe('file naming', () => {
    it('uses correct date format in filename', async () => {
      const date = new Date('2024-06-15T12:00:00Z')
      await store.append(createEntry({ timestamp: date }))

      const files = await readdir(testDir)
      expect(files[0]).toBe('audit-2024-06-15.jsonl')
    })
  })
})
