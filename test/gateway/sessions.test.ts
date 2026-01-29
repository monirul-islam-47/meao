/**
 * Tests for session routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createGateway } from '../../src/gateway/server.js'
import { Orchestrator } from '../../src/orchestrator/orchestrator.js'
import { MockProvider } from '../../src/provider/mock.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { ApprovalManager } from '../../src/tools/approvals.js'
import { SandboxExecutor } from '../../src/sandbox/executor.js'
import { AuditLogger } from '../../src/audit/service.js'
import { JsonlAuditStore } from '../../src/audit/store/index.js'
import { CLIChannel } from '../../src/channel/cli.js'
import { SessionManager, JsonlSessionStore } from '../../src/session/index.js'
import type { FastifyInstance } from 'fastify'

describe('Session Routes', () => {
  let app: FastifyInstance
  let testDir: string
  let sessionManager: SessionManager

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'meao-gateway-test-'))

    const provider = new MockProvider()
    const toolRegistry = new ToolRegistry()
    const channel = new CLIChannel()
    const approvalManager = new ApprovalManager(async () => true)
    const sandboxExecutor = new SandboxExecutor({ workDir: testDir })
    const auditStore = new JsonlAuditStore(join(testDir, 'audit'))
    const auditLogger = new AuditLogger(auditStore)

    const orchestrator = new Orchestrator(
      {
        channel,
        provider,
        toolRegistry,
        approvalManager,
        sandboxExecutor,
        auditLogger,
      },
      { streaming: false, workDir: testDir }
    )

    const sessionStore = new JsonlSessionStore(join(testDir, 'sessions'))
    sessionManager = new SessionManager(sessionStore)

    app = await createGateway(
      { host: '127.0.0.1', port: 0 },
      { orchestrator, sessionManager, auditLogger, config: { host: '127.0.0.1', port: 0 } }
    )
  })

  afterEach(async () => {
    await app.close()
    await rm(testDir, { recursive: true, force: true })
  })

  describe('POST /sessions', () => {
    it('creates a new session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: {},
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.id).toBeDefined()
      expect(body.state).toBe('active')
    })

    it('creates session with title', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Test Session' },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.id).toBeDefined()
    })
  })

  describe('GET /sessions', () => {
    it('lists sessions', async () => {
      // Create some sessions first
      await sessionManager.newSession({ title: 'Session 1' })
      await sessionManager.newSession({ title: 'Session 2' })

      const response = await app.inject({
        method: 'GET',
        url: '/sessions',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.sessions).toBeInstanceOf(Array)
      expect(body.sessions.length).toBeGreaterThanOrEqual(2)
    })

    it('limits results', async () => {
      for (let i = 0; i < 5; i++) {
        await sessionManager.newSession({ title: `Session ${i}` })
      }

      const response = await app.inject({
        method: 'GET',
        url: '/sessions?limit=3',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.sessions.length).toBe(3)
    })
  })

  describe('GET /sessions/:id', () => {
    it('returns session details', async () => {
      const session = await sessionManager.newSession({ title: 'Find Me' })

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${session.id}`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.id).toBe(session.id)
      expect(body.title).toBe('Find Me')
    })

    it('returns 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/non-existent',
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('DELETE /sessions/:id', () => {
    it('deletes a session', async () => {
      const session = await sessionManager.newSession({ title: 'Delete Me' })

      const response = await app.inject({
        method: 'DELETE',
        url: `/sessions/${session.id}`,
      })

      expect(response.statusCode).toBe(204)
    })

    it('returns 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/non-existent',
      })

      expect(response.statusCode).toBe(404)
    })
  })
})
