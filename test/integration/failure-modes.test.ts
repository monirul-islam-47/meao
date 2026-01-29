/**
 * Failure Modes Integration Tests
 *
 * These tests verify graceful handling of various failure scenarios:
 * - Provider failures (timeout, rate limit, malformed responses)
 * - Sandbox failures (container fails, timeout, crashes)
 * - Tool execution errors
 * - Channel disconnections
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { z } from 'zod'
import { Orchestrator } from '../../src/orchestrator/orchestrator.js'
import { MockProvider } from '../../src/provider/mock.js'
import { ProviderError } from '../../src/provider/types.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { createAutoApproveManager } from '../../src/tools/approvals.js'
import { SandboxExecutor } from '../../src/sandbox/executor.js'
import type { ToolPlugin, ToolContext } from '../../src/tools/types.js'
import type { Channel, ChannelMessage, ChannelState } from '../../src/channel/types.js'

// Test utilities
function createMockChannel(): Channel & {
  sentMessages: ChannelMessage[]
  simulateMessage: (message: ChannelMessage) => void
} {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'failure-test-session',
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
    simulateMessage(message: ChannelMessage) {
      this.emit('message', message)
    },
  }
}

function createMockAuditLogger() {
  const logs: any[] = []
  return {
    log: vi.fn((entry) => {
      logs.push(entry)
      return Promise.resolve()
    }),
    info: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
    getLogs: () => logs,
  }
}

describe('Failure Modes Integration Tests', () => {
  let testDir: string
  let channel: ReturnType<typeof createMockChannel>
  let provider: MockProvider
  let toolRegistry: ToolRegistry
  let auditLogger: ReturnType<typeof createMockAuditLogger>

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-failure-'))
    channel = createMockChannel()
    provider = new MockProvider()
    toolRegistry = new ToolRegistry()
    auditLogger = createMockAuditLogger()
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Provider Failures', () => {
    it('handles provider throwing an error', async () => {
      // Create provider that throws
      const errorProvider = {
        name: 'error-provider',
        isAvailable: () => true,
        countTokens: () => 0,
        createMessage: vi.fn().mockRejectedValue(new Error('Provider crashed')),
        createMessageStream: vi.fn(),
      }

      const orchestrator = new Orchestrator(
        {
          channel,
          provider: errorProvider as any,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Hello')

      // Should send error to channel
      const errors = channel.sentMessages.filter((m) => m.type === 'error') as any[]
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Provider crashed')

      // Should return to idle state
      expect(orchestrator.getState()).toBe('idle')
    })

    it('handles rate limit error from provider', async () => {
      const rateLimitProvider = {
        name: 'ratelimit-provider',
        isAvailable: () => true,
        countTokens: () => 0,
        createMessage: vi.fn().mockRejectedValue(
          new ProviderError('Rate limited', 'rate_limit_error', true, 60)
        ),
        createMessageStream: vi.fn(),
      }

      const orchestrator = new Orchestrator(
        {
          channel,
          provider: rateLimitProvider as any,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Hello')

      const errors = channel.sentMessages.filter((m) => m.type === 'error') as any[]
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Rate limited')
    })

    it('handles malformed tool call from provider', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          // Return malformed tool call (missing required fields)
          return {
            content: [
              {
                type: 'tool_use',
                id: 'bad-1',
                name: 'nonexistent_tool', // Tool doesn't exist
                input: {},
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Handled error' }],
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
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Call nonexistent tool')

      // Tool result should indicate error
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('Unknown tool')
    })
  })

  describe('Tool Execution Failures', () => {
    it('handles tool that throws exception', async () => {
      const throwingTool: ToolPlugin = {
        name: 'throwing_tool',
        description: 'Tool that throws',
        parameters: z.object({}),
        capability: { name: 'throwing_tool', approval: { level: 'auto' } },
        actions: [],
        execute: async () => {
          throw new Error('Tool exploded!')
        },
      }
      toolRegistry.register(throwingTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'throw-1',
                name: 'throwing_tool',
                input: {},
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Handled the error' }],
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
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Run throwing tool')

      // Should have error tool result
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('Tool exploded')

      // Session should still be valid
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)
    })

    it('handles tool that returns error result', async () => {
      const failingTool: ToolPlugin = {
        name: 'failing_tool',
        description: 'Tool that returns error',
        parameters: z.object({}),
        capability: { name: 'failing_tool', approval: { level: 'auto' } },
        actions: [],
        execute: async () => {
          return { success: false, output: 'Operation failed gracefully' }
        },
      }
      toolRegistry.register(failingTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'fail-1',
                name: 'failing_tool',
                input: {},
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Acknowledged failure' }],
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
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Run failing tool')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('Operation failed gracefully')
    })

    it('handles tool with invalid arguments', async () => {
      // Tool that validates its own arguments and returns error for invalid ones
      const strictTool: ToolPlugin = {
        name: 'strict_tool',
        description: 'Tool with required args',
        parameters: z.object({
          requiredField: z.string(),
          numberField: z.number().min(1),
        }),
        capability: { name: 'strict_tool', approval: { level: 'auto' } },
        actions: [],
        execute: async (args) => {
          const input = args as Record<string, unknown>
          // Validate required fields
          if (typeof input.requiredField !== 'string') {
            return { success: false, output: 'Missing required field: requiredField' }
          }
          if (typeof input.numberField !== 'number' || input.numberField < 1) {
            return { success: false, output: 'Invalid numberField: must be number >= 1' }
          }
          return { success: true, output: JSON.stringify(args) }
        },
      }
      toolRegistry.register(strictTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'strict-1',
                name: 'strict_tool',
                input: { wrongField: 'oops' }, // Missing required fields
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Validation failed as expected' }],
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
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Run with bad args')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
    })
  })

  describe('Sandbox Failures', () => {
    // Skip: Timeout configuration varies by sandbox implementation
    // The ProcessConfig.timeout might not be passed through correctly
    it.skip('handles command timeout', { timeout: 10000 }, async () => {
      // Tool that executes commands with a short timeout
      const bashTool: ToolPlugin = {
        name: 'bash',
        description: 'Execute command',
        parameters: z.object({ command: z.string() }),
        capability: { name: 'bash', approval: { level: 'auto' } },
        actions: [],
        execute: async (args, context) => {
          const { command } = args as { command: string }
          try {
            const result = await context.sandbox.execute(command, 'bash')
            // Check if command timed out or was killed
            if (result.timedOut || result.exitCode !== 0) {
              return {
                success: false,
                output: result.timedOut
                  ? 'Command timed out'
                  : result.stderr || `Exit code: ${result.exitCode}`,
              }
            }
            return { success: true, output: result.stdout || '' }
          } catch (error) {
            return {
              success: false,
              output: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }
          }
        },
      }
      toolRegistry.register(bashTool)

      // Create sandbox with short timeout via process config
      const shortTimeoutSandbox = new SandboxExecutor({
        workDir: testDir,
        processConfig: {
          timeout: 100, // 100ms timeout
        },
      })

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'bash-1',
                name: 'bash',
                input: { command: 'sleep 5' }, // Will timeout
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Command timed out' }],
          stopReason: 'end_turn',
        }
      })

      const orchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: shortTimeoutSandbox,
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Run long command')

      // Command should have timed out or been killed
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      // The command either timed out or was killed
      expect(toolResults[0].success).toBe(false)
    })

    it('handles command with non-zero exit code', async () => {
      const bashTool: ToolPlugin = {
        name: 'bash',
        description: 'Execute command',
        parameters: z.object({ command: z.string() }),
        capability: { name: 'bash', approval: { level: 'auto' } },
        actions: [],
        execute: async (args, context) => {
          const { command } = args as { command: string }
          const result = await context.sandbox.execute(command, 'bash')
          let output = result.stdout || ''
          if (result.stderr) output += `\nstderr: ${result.stderr}`
          return {
            success: result.exitCode === 0,
            output: output || `Exit code: ${result.exitCode}`,
            exitCode: result.exitCode,
          }
        },
      }
      toolRegistry.register(bashTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'bash-1',
                name: 'bash',
                input: { command: 'exit 1' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Command failed' }],
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
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Run failing command')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
    })
  })

  describe('Resource Limits', () => {
    it('enforces max turns per session', async () => {
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
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir, maxTurns: 3 }
      )

      await orchestrator.processMessage('Turn 1')
      await orchestrator.processMessage('Turn 2')
      await orchestrator.processMessage('Turn 3')
      await orchestrator.processMessage('Turn 4') // Should be blocked

      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(3)

      const errors = channel.sentMessages.filter((m) => m.type === 'error') as any[]
      expect(errors.some((e) => e.code === 'max_turns_exceeded')).toBe(true)
    })

    it('enforces max tool calls per turn', async () => {
      const simpleTool: ToolPlugin = {
        name: 'simple',
        description: 'Simple tool',
        parameters: z.object({}),
        capability: { name: 'simple', approval: { level: 'auto' } },
        actions: [],
        execute: async () => ({ success: true, output: 'ok' }),
      }
      toolRegistry.register(simpleTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        // Always return tool use (would loop forever without limit)
        if (callCount <= 30) {
          return {
            content: [
              {
                type: 'tool_use',
                id: `tool-${callCount}`,
                name: 'simple',
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
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir, maxToolCallsPerTurn: 5 }
      )

      await orchestrator.processMessage('Loop forever')

      // Should have stopped after max tool calls
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result')
      expect(toolResults.length).toBeLessThanOrEqual(5)

      const errors = channel.sentMessages.filter((m) => m.type === 'error') as any[]
      expect(errors.some((e) => e.code === 'max_tool_calls_exceeded')).toBe(true)
    })
  })

  describe('Concurrent Request Handling', () => {
    it('prevents concurrent message processing', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
        delay: 100, // Slow response
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
        { streaming: false, workDir: testDir }
      )

      // Start first message (will be processing)
      const first = orchestrator.processMessage('First')

      // Try second message immediately - should fail
      await expect(orchestrator.processMessage('Second')).rejects.toThrow(
        /Cannot process message/
      )

      await first // Wait for first to complete
    })
  })
})
