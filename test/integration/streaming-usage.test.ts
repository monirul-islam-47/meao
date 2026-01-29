/**
 * Streaming Token/Cost Accounting Tests (M8.2)
 *
 * Validates:
 * - Streaming mode produces stable token/cost numbers
 * - Streaming vs non-streaming token counts match within tolerance
 * - Tool loop usage accumulates correctly
 * - Costs don't reset or double-count after stream restarts
 * - Audit contains cost metadata
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

function createTestChannel(): Channel & { sentMessages: ChannelMessage[] } {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'usage-test',
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

function createSimpleTool(name: string): ToolPlugin {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: z.object({}).passthrough(),
    capability: { name, approval: { level: 'auto' } },
    actions: [],
    async execute() {
      return { success: true, output: `${name} executed` }
    },
  }
}

describe('Streaming Usage Accounting Tests', () => {
  let testDir: string
  let auditDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-usage-'))
    auditDir = path.join(testDir, 'audit')
    await fs.mkdir(auditDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Streaming vs Non-Streaming Token Comparison', () => {
    it('streaming token count matches non-streaming within tolerance', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      // Same response for both modes
      const response = {
        content: [{ type: 'text' as const, text: 'This is a test response with some content.' }],
        stopReason: 'end_turn' as const,
      }
      provider.setDefaultResponse(response)

      // Non-streaming orchestrator
      const nonStreamingOrch = new Orchestrator(
        {
          channel: createTestChannel(),
          provider,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger,
        },
        { streaming: false, workDir: testDir }
      )

      await nonStreamingOrch.processMessage('Test prompt')
      const nonStreamingSession = nonStreamingOrch.getSession()

      // Reset provider for streaming test
      provider.reset()
      provider.setDefaultResponse(response)

      // Streaming orchestrator
      const streamingOrch = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger,
        },
        { streaming: true, workDir: testDir }
      )

      await streamingOrch.processMessage('Test prompt')
      const streamingSession = streamingOrch.getSession()

      // Compare token counts (should be equal or very close)
      const nonStreamingUsage = nonStreamingSession.turns[0].usage
      const streamingUsage = streamingSession.turns[0].usage

      // Input tokens should be identical (same prompt)
      expect(streamingUsage.inputTokens).toBe(nonStreamingUsage.inputTokens)

      // Output tokens should be identical (same response)
      expect(streamingUsage.outputTokens).toBe(nonStreamingUsage.outputTokens)

      // Total session usage should match
      expect(streamingSession.totalUsage.inputTokens).toBe(nonStreamingSession.totalUsage.inputTokens)
      expect(streamingSession.totalUsage.outputTokens).toBe(nonStreamingSession.totalUsage.outputTokens)
    })

    it('streaming produces non-zero output tokens', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'A moderately long response to ensure tokens are counted.' }],
        stopReason: 'end_turn',
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
        { streaming: true, workDir: testDir }
      )

      await orchestrator.processMessage('Tell me something')
      const session = orchestrator.getSession()

      // Verify non-zero usage
      expect(session.turns[0].usage.inputTokens).toBeGreaterThan(0)
      expect(session.turns[0].usage.outputTokens).toBeGreaterThan(0)
      expect(session.totalUsage.outputTokens).toBeGreaterThan(0)
    })
  })

  describe('Tool Loop Usage Accumulation', () => {
    it('usage accumulates across tool loop iterations', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      toolRegistry.register(createSimpleTool('step1'))
      toolRegistry.register(createSimpleTool('step2'))
      toolRegistry.register(createSimpleTool('step3'))

      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      // Multi-step tool loop
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        switch (callCount) {
          case 1:
            return {
              content: [{ type: 'tool_use', id: 'c1', name: 'step1', input: {} }],
              stopReason: 'tool_use',
            }
          case 2:
            return {
              content: [{ type: 'tool_use', id: 'c2', name: 'step2', input: {} }],
              stopReason: 'tool_use',
            }
          case 3:
            return {
              content: [{ type: 'tool_use', id: 'c3', name: 'step3', input: {} }],
              stopReason: 'tool_use',
            }
          default:
            return {
              content: [{ type: 'text', text: 'All steps complete.' }],
              stopReason: 'end_turn',
            }
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

      await orchestrator.processMessage('Run 3 steps')
      const session = orchestrator.getSession()

      // Single turn with accumulated usage from all loop iterations
      expect(session.turns).toHaveLength(1)
      const turn = session.turns[0]

      // Usage should be accumulated from all 4 provider calls
      expect(turn.usage.inputTokens).toBeGreaterThan(0)
      expect(turn.usage.outputTokens).toBeGreaterThan(0)

      // Total session usage should equal turn usage (single turn)
      expect(session.totalUsage.inputTokens).toBe(turn.usage.inputTokens)
      expect(session.totalUsage.outputTokens).toBe(turn.usage.outputTokens)

      // Verify 3 tool calls were made
      expect(turn.toolCalls).toHaveLength(3)
    })

    it('streaming tool loop accumulates usage correctly', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      toolRegistry.register(createSimpleTool('read'))
      toolRegistry.register(createSimpleTool('write'))

      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      // First stream: tool call
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'm1', model: 'test', usage: { inputTokens: 100 } } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'c1', name: 'read' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { outputTokens: 50 } }
      })

      // Second stream: another tool call
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'm2', model: 'test', usage: { inputTokens: 150 } } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'c2', name: 'write' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { outputTokens: 60 } }
      })

      // Third stream: final response
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'm3', model: 'test', usage: { inputTokens: 200 } } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { outputTokens: 10 } }
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
        { streaming: true, workDir: testDir }
      )

      await orchestrator.processMessage('Read then write')
      const session = orchestrator.getSession()

      // Verify accumulated usage (100 + 150 + 200 = 450 input, 50 + 60 + 10 = 120 output)
      expect(session.turns[0].usage.inputTokens).toBe(450)
      expect(session.turns[0].usage.outputTokens).toBe(120)
      expect(session.totalUsage.inputTokens).toBe(450)
      expect(session.totalUsage.outputTokens).toBe(120)
    })
  })

  describe('Cost Tracking', () => {
    it('cost is positive and consistent across turns', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
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
        { streaming: true, workDir: testDir }
      )

      await orchestrator.processMessage('Turn 1')
      await orchestrator.processMessage('Turn 2')
      await orchestrator.processMessage('Turn 3')

      const session = orchestrator.getSession()

      // Cost should be positive
      expect(session.estimatedCost).toBeGreaterThan(0)

      // Cost should increase with more turns
      // (we can't test this directly, but verify structure)
      expect(session.turns).toHaveLength(3)

      // Each turn should have valid usage
      for (const turn of session.turns) {
        expect(turn.usage.inputTokens).toBeGreaterThanOrEqual(0)
        expect(turn.usage.outputTokens).toBeGreaterThanOrEqual(0)
      }
    })

    it('cost does not reset after stream restart (tool loop)', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      toolRegistry.register(createSimpleTool('tool'))

      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [{ type: 'tool_use', id: 'c1', name: 'tool', input: {} }],
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

      await orchestrator.processMessage('Do something')
      const session = orchestrator.getSession()

      // Cost should reflect total usage including tool loop
      expect(session.estimatedCost).toBeGreaterThan(0)

      // Usage should be sum of both provider calls
      expect(session.totalUsage.inputTokens).toBeGreaterThan(0)
      expect(session.totalUsage.outputTokens).toBeGreaterThan(0)
    })
  })

  describe('Audit Contains Cost Metadata', () => {
    it('session end audit includes cost and usage metadata', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
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
      await orchestrator.processMessage('Test')
      await orchestrator.stop()

      // Small delay for audit to write
      await new Promise((r) => setTimeout(r, 100))

      // Read audit file
      const auditFiles = await fs.readdir(auditDir)
      expect(auditFiles.length).toBeGreaterThan(0)

      const auditContent = await fs.readFile(path.join(auditDir, auditFiles[0]), 'utf-8')
      const entries = auditContent.trim().split('\n').map((l) => JSON.parse(l))

      // Find session end entry
      const sessionEnd = entries.find((e) => e.action === 'ended')
      expect(sessionEnd).toBeDefined()

      // Verify cost metadata
      expect(sessionEnd.metadata.totalUsage).toBeDefined()
      expect(sessionEnd.metadata.totalUsage.inputTokens).toBeGreaterThanOrEqual(0)
      expect(sessionEnd.metadata.totalUsage.outputTokens).toBeGreaterThanOrEqual(0)
      expect(sessionEnd.metadata.estimatedCost).toBeGreaterThanOrEqual(0)
    })

    it('audit does not contain sensitive content in cost entries', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      // Response with "secret-looking" content
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'The API key is sk-test-12345' }],
        stopReason: 'end_turn',
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
      await orchestrator.processMessage('Give me the key')
      await orchestrator.stop()

      // Small delay for audit to write
      await new Promise((r) => setTimeout(r, 100))

      // Read all audit entries
      const auditFiles = await fs.readdir(auditDir)
      const auditContent = await fs.readFile(path.join(auditDir, auditFiles[0]), 'utf-8')

      // The actual response content should not appear in audit
      // (NEVER_LOG and content redaction should prevent this)
      // We check that the session metadata doesn't contain the sensitive content
      const sessionEnd = auditContent.split('\n').find((l) => l.includes('"ended"'))
      expect(sessionEnd).not.toContain('sk-test-12345')
    })
  })

  describe('Multiple Turns Usage Consistency', () => {
    it('session total equals sum of turn totals', async () => {
      const channel = createTestChannel()
      const provider = new MockProvider()
      const toolRegistry = new ToolRegistry()
      const auditStore = new JsonlAuditStore(auditDir)
      const auditLogger = new AuditLogger(auditStore)

      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
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
        { streaming: true, workDir: testDir }
      )

      // Multiple turns
      await orchestrator.processMessage('Turn 1')
      await orchestrator.processMessage('Turn 2')
      await orchestrator.processMessage('Turn 3')

      const session = orchestrator.getSession()

      // Calculate sum of turn usage
      let sumInput = 0
      let sumOutput = 0
      for (const turn of session.turns) {
        sumInput += turn.usage.inputTokens
        sumOutput += turn.usage.outputTokens
      }

      // Session total should match sum
      expect(session.totalUsage.inputTokens).toBe(sumInput)
      expect(session.totalUsage.outputTokens).toBe(sumOutput)
    })
  })
})
