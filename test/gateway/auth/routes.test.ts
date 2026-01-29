/**
 * Tests for auth routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createGateway } from '../../../src/gateway/server.js'
import { Orchestrator } from '../../../src/orchestrator/orchestrator.js'
import { MockProvider } from '../../../src/provider/mock.js'
import { ToolRegistry } from '../../../src/tools/registry.js'
import { ApprovalManager } from '../../../src/tools/approvals.js'
import { SandboxExecutor } from '../../../src/sandbox/executor.js'
import { AuditLogger } from '../../../src/audit/service.js'
import { JsonlAuditStore } from '../../../src/audit/store/index.js'
import { CLIChannel } from '../../../src/channel/cli.js'
import { SessionManager, JsonlSessionStore } from '../../../src/session/index.js'
import { DevicePairing, FileTokenStore } from '../../../src/gateway/auth/index.js'
import type { FastifyInstance } from 'fastify'

describe('Auth Routes', () => {
  let app: FastifyInstance
  let testDir: string
  let pairing: DevicePairing
  let tokenStore: FileTokenStore

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'meao-auth-routes-test-'))

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

    tokenStore = new FileTokenStore(join(testDir, 'tokens'))
    pairing = new DevicePairing(tokenStore)

    app = await createGateway(
      { host: '127.0.0.1', port: 0 },
      {
        orchestrator,
        sessionManager,
        auditLogger,
        config: { host: '127.0.0.1', port: 0 },
        tokenStore,
        pairing,
      }
    )
  })

  afterEach(async () => {
    await app.close()
    await rm(testDir, { recursive: true, force: true })
  })

  describe('POST /auth/pair/request', () => {
    it('generates a pairing code', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/pair/request',
        payload: { deviceName: 'My Phone' },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.code).toMatch(/^[A-Z0-9]{6}$/)
      expect(body.expiresIn).toBe(300)
    })

    it('rejects missing deviceName', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/pair/request',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /auth/pair/verify', () => {
    it('verifies valid code and returns token', async () => {
      // Generate a code first
      const code = pairing.generateCode('Test Device')

      const response = await app.inject({
        method: 'POST',
        url: '/auth/pair/verify',
        payload: { code },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.success).toBe(true)
      expect(body.token).toBeDefined()
    })

    it('rejects invalid code', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/pair/verify',
        payload: { code: 'BADCOD' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toContain('Invalid')
    })
  })

  describe('GET /auth/pair/status/:code', () => {
    it('returns code status', async () => {
      const code = pairing.generateCode('My Device')

      const response = await app.inject({
        method: 'GET',
        url: `/auth/pair/status/${code}`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.deviceName).toBe('My Device')
      expect(body.expiresIn).toBeGreaterThan(0)
    })

    it('returns 404 for unknown code', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/pair/status/UNKNOW',
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('DELETE /auth/pair/:code', () => {
    it('cancels a pairing request', async () => {
      const code = pairing.generateCode('Device')

      const response = await app.inject({
        method: 'DELETE',
        url: `/auth/pair/${code}`,
      })

      expect(response.statusCode).toBe(204)

      // Verify code is gone
      expect(pairing.getCodeInfo(code)).toBeNull()
    })

    it('returns 404 for unknown code', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/auth/pair/UNKNOW',
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('GET /auth/tokens', () => {
    it('lists tokens for owner', async () => {
      // Create some tokens
      await tokenStore.save('token1', {
        userId: 'user1',
        deviceName: 'Device 1',
        role: 'user',
        createdAt: Date.now(),
      })

      const response = await app.inject({
        method: 'GET',
        url: '/auth/tokens',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.tokens).toHaveLength(1)
      expect(body.tokens[0].deviceName).toBe('Device 1')
    })
  })

  describe('DELETE /auth/tokens/:hash', () => {
    it('revokes a token', async () => {
      await tokenStore.save('mytoken', {
        userId: 'user1',
        deviceName: 'Device',
        role: 'user',
        createdAt: Date.now(),
      })

      const tokens = await tokenStore.list()
      const hash = tokens[0].hash.slice(0, 8)

      const response = await app.inject({
        method: 'DELETE',
        url: `/auth/tokens/${hash}`,
      })

      expect(response.statusCode).toBe(204)

      // Token should be revoked
      const info = await tokenStore.verify('mytoken')
      expect(info).toBeNull()
    })

    it('returns 404 for unknown token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/auth/tokens/unknown',
      })

      expect(response.statusCode).toBe(404)
    })
  })
})
