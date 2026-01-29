/**
 * Tests for health endpoints
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

describe('Health Endpoints', () => {
  let app: FastifyInstance
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'meao-gateway-test-'))

    // Create mock components
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
    const sessionManager = new SessionManager(sessionStore)

    app = await createGateway(
      { host: '127.0.0.1', port: 0 },
      { orchestrator, sessionManager, auditLogger, config: { host: '127.0.0.1', port: 0 } }
    )
  })

  afterEach(async () => {
    await app.close()
    await rm(testDir, { recursive: true, force: true })
  })

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.status).toBe('ok')
      expect(body.timestamp).toBeDefined()
    })
  })

  describe('GET /health/detailed', () => {
    it('returns detailed health info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/detailed',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.status).toBe('ok')
      expect(body.uptime).toBeGreaterThan(0)
      expect(body.memory).toBeDefined()
    })
  })

  describe('GET /ready', () => {
    it('returns ready status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ready: true })
    })
  })
})
