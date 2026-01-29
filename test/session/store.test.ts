/**
 * Tests for session store
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonlSessionStore } from '../../src/session/store.js'

describe('JsonlSessionStore', () => {
  let testDir: string
  let store: JsonlSessionStore

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'meao-session-test-'))
    store = new JsonlSessionStore(testDir)
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('creates a session with generated ID', async () => {
      const session = await store.create({})
      expect(session.id).toBeDefined()
      expect(session.id.length).toBe(36) // UUID
      expect(session.state).toBe('active')
      expect(session.messageCount).toBe(0)
      expect(session.messages).toEqual([])
    })

    it('creates a session with custom ID', async () => {
      const session = await store.create({ id: 'custom-id' })
      expect(session.id).toBe('custom-id')
    })

    it('creates a session with metadata', async () => {
      const session = await store.create({
        title: 'Test Session',
        model: 'claude-3-opus',
        workDir: '/tmp/test',
      })
      expect(session.title).toBe('Test Session')
      expect(session.model).toBe('claude-3-opus')
      expect(session.workDir).toBe('/tmp/test')
    })
  })

  describe('get', () => {
    it('retrieves an existing session', async () => {
      const created = await store.create({ title: 'Find Me' })
      const retrieved = await store.get(created.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.title).toBe('Find Me')
    })

    it('returns null for non-existent session', async () => {
      const session = await store.get('non-existent')
      expect(session).toBeNull()
    })
  })

  describe('update', () => {
    it('updates session metadata', async () => {
      const session = await store.create({})
      await store.update(session.id, { title: 'Updated Title' })

      const retrieved = await store.get(session.id)
      expect(retrieved?.title).toBe('Updated Title')
    })

    it('updates updatedAt timestamp', async () => {
      const session = await store.create({})
      const originalUpdatedAt = session.updatedAt

      await new Promise(r => setTimeout(r, 10))
      await store.update(session.id, { title: 'New' })

      const retrieved = await store.get(session.id)
      expect(retrieved?.updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('throws for non-existent session', async () => {
      await expect(store.update('missing', { title: 'X' })).rejects.toThrow()
    })
  })

  describe('addMessage', () => {
    it('adds a user message', async () => {
      const session = await store.create({})
      await store.addMessage(session.id, {
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      })

      const retrieved = await store.get(session.id)
      expect(retrieved?.messages).toHaveLength(1)
      expect(retrieved?.messages[0].role).toBe('user')
      expect(retrieved?.messages[0].content).toBe('Hello')
      expect(retrieved?.messageCount).toBe(1)
    })

    it('adds multiple messages', async () => {
      const session = await store.create({})
      await store.addMessage(session.id, { role: 'user', content: 'Hi', timestamp: Date.now() })
      await store.addMessage(session.id, { role: 'assistant', content: 'Hello!', timestamp: Date.now() })
      await store.addMessage(session.id, { role: 'user', content: 'Bye', timestamp: Date.now() })

      const retrieved = await store.get(session.id)
      expect(retrieved?.messages).toHaveLength(3)
      expect(retrieved?.messageCount).toBe(3)
    })

    it('redacts secrets in tool results', async () => {
      const session = await store.create({})
      await store.addMessage(session.id, {
        role: 'tool_result',
        content: 'API_KEY=sk-ant-api03-secret123',
        timestamp: Date.now(),
        toolCallId: 't1',
        toolName: 'bash',
      })

      const retrieved = await store.get(session.id)
      expect(retrieved?.messages[0].content).toContain('[REDACTED')
      expect(retrieved?.messages[0].redacted).toBe(true)
    })

    it('tracks token count', async () => {
      const session = await store.create({})
      await store.addMessage(session.id, {
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
        tokens: 10,
      })
      await store.addMessage(session.id, {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now(),
        tokens: 20,
      })

      const retrieved = await store.get(session.id)
      expect(retrieved?.totalTokens).toBe(30)
    })
  })

  describe('list', () => {
    it('lists all sessions', async () => {
      await store.create({ title: 'Session 1' })
      await store.create({ title: 'Session 2' })
      await store.create({ title: 'Session 3' })

      const sessions = await store.list()
      expect(sessions).toHaveLength(3)
    })

    it('filters by state', async () => {
      await store.create({ state: 'active' })
      await store.create({ state: 'paused' })
      await store.create({ state: 'completed' })

      const active = await store.list({ state: 'active' })
      expect(active).toHaveLength(1)
      expect(active[0].state).toBe('active')

      const paused = await store.list({ state: 'paused' })
      expect(paused).toHaveLength(1)
    })

    it('sorts by updatedAt descending by default', async () => {
      const s1 = await store.create({ title: 'First' })
      await new Promise(r => setTimeout(r, 10))
      const s2 = await store.create({ title: 'Second' })
      await new Promise(r => setTimeout(r, 10))
      const s3 = await store.create({ title: 'Third' })

      const sessions = await store.list()
      expect(sessions[0].id).toBe(s3.id)
      expect(sessions[2].id).toBe(s1.id)
    })

    it('limits results', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create({ title: `Session ${i}` })
      }

      const sessions = await store.list({ limit: 5 })
      expect(sessions).toHaveLength(5)
    })

    it('paginates with offset', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create({ title: `Session ${i}` })
      }

      const page1 = await store.list({ limit: 5, offset: 0 })
      const page2 = await store.list({ limit: 5, offset: 5 })

      expect(page1).toHaveLength(5)
      expect(page2).toHaveLength(5)
      expect(page1[0].id).not.toBe(page2[0].id)
    })
  })

  describe('delete', () => {
    it('deletes a session', async () => {
      const session = await store.create({})
      expect(await store.exists(session.id)).toBe(true)

      await store.delete(session.id)
      expect(await store.exists(session.id)).toBe(false)
    })

    it('does not throw for non-existent session', async () => {
      await expect(store.delete('missing')).resolves.not.toThrow()
    })
  })

  describe('exists', () => {
    it('returns true for existing session', async () => {
      const session = await store.create({})
      expect(await store.exists(session.id)).toBe(true)
    })

    it('returns false for non-existent session', async () => {
      expect(await store.exists('nope')).toBe(false)
    })
  })
})
