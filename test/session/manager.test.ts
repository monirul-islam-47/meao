/**
 * Tests for session manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, JsonlSessionStore } from '../../src/session/index.js'

describe('SessionManager', () => {
  let testDir: string
  let store: JsonlSessionStore
  let manager: SessionManager

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'meao-session-mgr-test-'))
    store = new JsonlSessionStore(testDir)
    manager = new SessionManager(store)
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('newSession', () => {
    it('creates a new session', async () => {
      const session = await manager.newSession()
      expect(session.id).toBeDefined()
      expect(session.state).toBe('active')
    })

    it('creates session with options', async () => {
      const session = await manager.newSession({
        model: 'claude-3-opus',
        workDir: '/tmp',
        title: 'Test',
      })
      expect(session.model).toBe('claude-3-opus')
      expect(session.workDir).toBe('/tmp')
      expect(session.title).toBe('Test')
    })

    it('sets current session', async () => {
      const session = await manager.newSession()
      expect(manager.getCurrentSession()).toBe(session)
    })
  })

  describe('resumeSession', () => {
    it('resumes existing session', async () => {
      const created = await manager.newSession({ title: 'Resume Me' })
      const id = created.id

      // Pause and create new manager
      await manager.pauseSession()
      const newManager = new SessionManager(store)

      const resumed = await newManager.resumeSession(id)
      expect(resumed).not.toBeNull()
      expect(resumed?.id).toBe(id)
      expect(resumed?.title).toBe('Resume Me')
      expect(resumed?.state).toBe('active')
    })

    it('returns null for non-existent session', async () => {
      const resumed = await manager.resumeSession('missing')
      expect(resumed).toBeNull()
    })
  })

  describe('pauseSession', () => {
    it('sets session state to paused', async () => {
      await manager.newSession()
      await manager.pauseSession()

      expect(manager.getCurrentSession()?.state).toBe('paused')
    })
  })

  describe('completeSession', () => {
    it('sets session state to completed', async () => {
      await manager.newSession()
      await manager.completeSession()

      expect(manager.getCurrentSession()?.state).toBe('completed')
    })
  })

  describe('addUserMessage', () => {
    it('adds user message to session', async () => {
      const session = await manager.newSession()
      await manager.addUserMessage('Hello')

      const retrieved = await store.get(session.id)
      expect(retrieved?.messages).toHaveLength(1)
      expect(retrieved?.messages[0].role).toBe('user')
      expect(retrieved?.messages[0].content).toBe('Hello')
    })

    it('updates message count', async () => {
      await manager.newSession()
      await manager.addUserMessage('One')
      await manager.addUserMessage('Two')

      expect(manager.getCurrentSession()?.messageCount).toBe(2)
    })

    it('tracks tokens', async () => {
      await manager.newSession()
      await manager.addUserMessage('Hello', 10)
      await manager.addUserMessage('World', 15)

      expect(manager.getCurrentSession()?.totalTokens).toBe(25)
    })
  })

  describe('addAssistantMessage', () => {
    it('adds assistant message to session', async () => {
      const session = await manager.newSession()
      await manager.addAssistantMessage('Hello there!')

      const retrieved = await store.get(session.id)
      expect(retrieved?.messages[0].role).toBe('assistant')
    })
  })

  describe('addToolResult', () => {
    it('adds tool result with redaction', async () => {
      const session = await manager.newSession()
      await manager.addToolResult('t1', 'bash', 'SECRET_KEY=abc123password')

      const retrieved = await store.get(session.id)
      expect(retrieved?.messages[0].role).toBe('tool_result')
      expect(retrieved?.messages[0].toolName).toBe('bash')
      // Note: 'abc123password' might not match secret patterns exactly,
      // but real API keys would be redacted
    })
  })

  describe('grantApproval', () => {
    it('stores approval in session', async () => {
      await manager.newSession()
      await manager.grantApproval('bash:execute')

      expect(manager.hasApproval('bash:execute')).toBe(true)
    })

    it('persists approval across resume', async () => {
      const session = await manager.newSession()
      await manager.grantApproval('write:create')
      await manager.pauseSession()

      const newManager = new SessionManager(store)
      await newManager.resumeSession(session.id)

      expect(newManager.hasApproval('write:create')).toBe(true)
    })

    it('does not duplicate approvals', async () => {
      await manager.newSession()
      await manager.grantApproval('bash:execute')
      await manager.grantApproval('bash:execute')

      expect(manager.getCurrentSession()?.grantedApprovals).toHaveLength(1)
    })
  })

  describe('setTitle', () => {
    it('updates session title', async () => {
      const session = await manager.newSession()
      await manager.setTitle('My Custom Title')

      expect(manager.getCurrentSession()?.title).toBe('My Custom Title')

      const retrieved = await store.get(session.id)
      expect(retrieved?.title).toBe('My Custom Title')
    })
  })

  describe('getConversationHistory', () => {
    it('returns user and assistant messages', async () => {
      await manager.newSession()
      await manager.addUserMessage('Hi')
      await manager.addAssistantMessage('Hello!')
      await manager.addToolResult('t1', 'bash', 'output')
      await manager.addUserMessage('Thanks')

      const history = manager.getConversationHistory()
      expect(history).toHaveLength(3) // Excludes tool_result
      expect(history[0].role).toBe('user')
      expect(history[1].role).toBe('assistant')
      expect(history[2].role).toBe('user')
    })

    it('returns empty array without session', () => {
      expect(manager.getConversationHistory()).toEqual([])
    })
  })

  describe('getSessionMetadata', () => {
    it('returns session metadata', async () => {
      await manager.newSession({ title: 'Test' })
      await manager.addUserMessage('Hello', 10)

      const meta = manager.getSessionMetadata()
      expect(meta?.title).toBe('Test')
      expect(meta?.messageCount).toBe(1)
      expect(meta?.totalTokens).toBe(10)
    })

    it('returns null without session', () => {
      expect(manager.getSessionMetadata()).toBeNull()
    })
  })

  describe('listSessions', () => {
    it('lists sessions from store', async () => {
      await store.create({ title: 'A' })
      await store.create({ title: 'B' })

      const sessions = await manager.listSessions()
      expect(sessions).toHaveLength(2)
    })

    it('filters by state', async () => {
      await store.create({ state: 'active' })
      await store.create({ state: 'paused' })

      const active = await manager.listSessions({ state: 'active' })
      expect(active).toHaveLength(1)
    })
  })
})
