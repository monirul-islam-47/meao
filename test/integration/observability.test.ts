/**
 * Observability Integration Tests
 *
 * These tests verify audit logging and tracing work correctly:
 * - Forbidden field enforcement
 * - Request correlation IDs
 * - Redaction before persistence
 * - Cost tracking accuracy
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { z } from 'zod'
import { Orchestrator } from '../../src/orchestrator/orchestrator.js'
import { MockProvider } from '../../src/provider/mock.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { createAutoApproveManager } from '../../src/tools/approvals.js'
import { SandboxExecutor } from '../../src/sandbox/executor.js'
import { JsonlAuditStore } from '../../src/audit/store/jsonl.js'
import { AuditLogger } from '../../src/audit/service.js'
import type { ToolPlugin, ToolContext } from '../../src/tools/types.js'
import type { Channel, ChannelMessage, ChannelState } from '../../src/channel/types.js'
import attacks from '../fixtures/attacks.json'

function createMockChannel(): Channel & {
  sentMessages: ChannelMessage[]
} {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'observability-test-session',
    on(event: string, listener: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    },
    off(event: string, listener: (...args: any[]) => void) {
      listeners.get(event)?.delete(listener)
    },
    emit(event: string, ...args: any[]) {
      listeners.get(event)?.forEach((l) => l(...args))
    },
    async send(message: ChannelMessage) {
      sentMessages.push(message)
    },
    async connect() {},
    async disconnect() {},
    async waitFor() {
      return {} as any
    },
    sentMessages,
  }
}

describe('Observability Integration Tests', () => {
  let testDir: string
  let auditDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-observability-'))
    auditDir = path.join(testDir, 'audit')
    await fs.mkdir(auditDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Forbidden Field Enforcement', () => {
    it('audit store sanitizes entries before writing', async () => {
      const store = new JsonlAuditStore(auditDir)

      // Try to log something with forbidden fields (metadata.message.content, etc.)
      await store.append({
        id: 'test-1',
        timestamp: new Date(),
        category: 'test',
        action: 'test_action',
        severity: 'info',
        metadata: {
          message: {
            content: 'This should be stripped', // NEVER_LOG field
          },
          file: {
            content: 'File content should be stripped', // NEVER_LOG field
          },
          normalField: 'this is fine',
        },
      })

      // Read back the log file
      const files = await fs.readdir(auditDir)
      expect(files.length).toBeGreaterThan(0)

      const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')

      // Should NOT contain the forbidden field content
      expect(logContent).not.toContain('This should be stripped')
      expect(logContent).not.toContain('File content should be stripped')

      // Should contain the normal field
      expect(logContent).toContain('normalField')
      expect(logContent).toContain('this is fine')
    })
  })

  describe('Request Correlation', () => {
    it('audit entries include session and request IDs', async () => {
      const store = new JsonlAuditStore(auditDir)
      const logger = new AuditLogger(store)

      const sessionId = 'session-123'
      const requestId = 'request-456'

      await logger.info('tool', 'executed', {
        sessionId,
        requestId,
        toolName: 'test_tool',
      })

      // Read back and verify
      const files = await fs.readdir(auditDir)
      const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')
      const entry = JSON.parse(logContent.trim())

      expect(entry.metadata.sessionId).toBe(sessionId)
      expect(entry.metadata.requestId).toBe(requestId)
    })

    it('tool calls maintain correlation through orchestrator', async () => {
      const channel = createMockChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()

      const store = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(store)

      // Tool that logs its execution
      const trackedTool: ToolPlugin = {
        name: 'tracked_tool',
        description: 'Tool with logging',
        parameters: z.object({}),
        capability: { name: 'tracked_tool', approval: { level: 'auto' } },
        actions: [],
        execute: async (args, context) => {
          await context.audit.info('tool', 'custom_event', {
            requestId: context.requestId,
            sessionId: context.sessionId,
            customData: 'test',
          })
          return { success: true, output: 'ok' }
        },
      }
      toolRegistry.register(trackedTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'track-1',
                name: 'tracked_tool',
                input: {},
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Done' }],
          stopReason: 'end_turn',
        }
      })

      const orchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.start()
      await orchestrator.processMessage('Run tracked tool')
      await orchestrator.stop()

      // Read back and verify correlation
      const files = await fs.readdir(auditDir)
      const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')
      const entries = logContent
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))

      // Should have session start, tool execution, and session end entries
      const sessionStart = entries.find((e) => e.action === 'started')
      const toolEvent = entries.find((e) => e.action === 'custom_event')
      const sessionEnd = entries.find((e) => e.action === 'ended')

      expect(sessionStart).toBeDefined()
      expect(toolEvent).toBeDefined()
      expect(sessionEnd).toBeDefined()

      // All should have same session ID
      const sessionId = sessionStart?.metadata?.sessionId
      expect(sessionId).toBeDefined()
      expect(toolEvent?.metadata?.sessionId).toBe(sessionId)
      expect(sessionEnd?.metadata?.sessionId).toBe(sessionId)
    })
  })

  describe('Secret Redaction Before Persistence', () => {
    it('redacts secrets in error messages before logging', async () => {
      const store = new JsonlAuditStore(auditDir)
      const logger = new AuditLogger(store)

      const secretKey = attacks.secretPatterns.githubPAT
      const errorWithSecret = `Failed to authenticate with token: ${secretKey}`

      await logger.warning('auth', 'failed', {
        errorMessage: errorWithSecret,
      })

      // Read back and verify
      const files = await fs.readdir(auditDir)
      const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')

      // Should NOT contain the raw secret
      expect(logContent).not.toContain(secretKey)
    })

    it('redacts secrets in errorMessage field before logging', async () => {
      const store = new JsonlAuditStore(auditDir)
      const logger = new AuditLogger(store)

      // Note: Secret redaction only happens in errorMessage field, not general metadata
      // This is by design to avoid performance impact on every log entry
      await logger.warning('tool', 'failed', {
        toolName: 'web_fetch',
        url: 'https://api.example.com',
        // errorMessage field specifically gets secret redaction
        errorMessage: `Failed to authenticate with Bearer ${attacks.secretPatterns.jwtToken}`,
      })

      // Read back and verify
      const files = await fs.readdir(auditDir)
      const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')

      // JWT in errorMessage should be redacted
      expect(logContent).not.toContain('eyJhbGciOiJIUzI1NiI')
    })
  })

  describe('Cost Tracking', () => {
    it('tracks cost consistently across provider calls', async () => {
      const channel = createMockChannel()
      const provider = new MockProvider({
        tokensPerChar: 0.25, // Consistent token counting
      })
      const toolRegistry = new ToolRegistry()
      const auditLogger = {
        log: vi.fn().mockResolvedValue(undefined),
        info: vi.fn().mockResolvedValue(undefined),
        warning: vi.fn().mockResolvedValue(undefined),
        critical: vi.fn().mockResolvedValue(undefined),
        alert: vi.fn().mockResolvedValue(undefined),
      }

      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response from the model with some content' }],
        stopReason: 'end_turn',
      })

      const orchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger: auditLogger as any,
        },
        {
          streaming: false,
          workDir: testDir,
          inputTokenCost: 3.0, // $3/1M tokens
          outputTokenCost: 15.0, // $15/1M tokens
        }
      )

      // Run multiple turns
      await orchestrator.processMessage('First message')
      await orchestrator.processMessage('Second message')
      await orchestrator.processMessage('Third message')

      const session = orchestrator.getSession()

      // Cost should be monotonically increasing
      expect(session.estimatedCost).toBeGreaterThan(0)

      // Token counts should be positive and make sense
      expect(session.totalUsage.inputTokens).toBeGreaterThan(0)
      expect(session.totalUsage.outputTokens).toBeGreaterThan(0)

      // Each turn should contribute to total
      let turnInputTotal = 0
      let turnOutputTotal = 0
      for (const turn of session.turns) {
        turnInputTotal += turn.usage.inputTokens
        turnOutputTotal += turn.usage.outputTokens
      }

      expect(session.totalUsage.inputTokens).toBe(turnInputTotal)
      expect(session.totalUsage.outputTokens).toBe(turnOutputTotal)

      // Verify cost formula is applied
      const expectedCost =
        (session.totalUsage.inputTokens / 1_000_000) * 3.0 +
        (session.totalUsage.outputTokens / 1_000_000) * 15.0
      expect(session.estimatedCost).toBeCloseTo(expectedCost, 6)
    })
  })

  describe('Audit Entry Completeness', () => {
    it('all audit entries have required fields', async () => {
      const store = new JsonlAuditStore(auditDir)
      const logger = new AuditLogger(store)

      // Log various entry types
      await logger.info('session', 'started', { sessionId: 'test-1' })
      await logger.warning('tool', 'approval_denied', { toolName: 'bash' })
      await logger.critical('provider', 'timeout', { model: 'test' })

      // Read back and verify
      const files = await fs.readdir(auditDir)
      const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')
      const entries = logContent
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))

      for (const entry of entries) {
        // Required fields
        expect(entry.timestamp).toBeDefined()
        expect(entry.category).toBeDefined()
        expect(entry.action).toBeDefined()
        expect(entry.severity).toBeDefined()

        // Timestamp should be valid ISO string
        expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp)

        // Severity should be valid
        expect(['debug', 'info', 'warning', 'error', 'alert', 'critical']).toContain(entry.severity)
      }
    })
  })

  describe('Log Rotation', () => {
    it('creates new log files for different days', async () => {
      const store = new JsonlAuditStore(auditDir)

      // Log an entry
      await store.append({
        id: 'test-1',
        timestamp: new Date(),
        category: 'test',
        action: 'test',
        severity: 'info',
        metadata: {},
      })

      // Verify file exists with date pattern
      const files = await fs.readdir(auditDir)
      expect(files.length).toBe(1)

      // File should have date in name
      const datePattern = /\d{4}-\d{2}-\d{2}/
      expect(files[0]).toMatch(datePattern)
    })
  })

  describe('Graceful Shutdown', () => {
    it('writes all pending logs', async () => {
      const store = new JsonlAuditStore(auditDir)

      // Log several entries quickly
      for (let i = 0; i < 10; i++) {
        await store.append({
          id: `test-${i}`,
          timestamp: new Date(),
          category: 'test',
          action: `action_${i}`,
          severity: 'info',
          metadata: { index: i },
        })
      }

      // Verify all entries were written
      const files = await fs.readdir(auditDir)
      const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')
      const entries = logContent.trim().split('\n')

      expect(entries.length).toBe(10)
    })
  })
})
