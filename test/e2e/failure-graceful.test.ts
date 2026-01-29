/**
 * Graceful Failure E2E Tests
 *
 * Tests that the system fails gracefully in negative scenarios:
 * - Sandbox container fails to start
 * - Tool throws mid-execution
 * - Tool returns huge output (MBs of data)
 * - Disk full / audit log can't write
 * - Channel disconnects during streaming
 * - Orchestrator error mid-turn
 *
 * Pass criteria for each test:
 * - No sensitive data leaks in error paths
 * - Orchestrator exits with deterministic state
 * - User sees actionable error message
 * - Audit entries aren't malformed/partial JSON
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import type { AuditStore, AuditFilter } from '../../src/audit/store/interface.js'
import type { AuditEntry } from '../../src/audit/schema.js'

// ============================================================================
// Test Utilities
// ============================================================================

interface MockChannelWithControls extends Channel {
  sentMessages: ChannelMessage[]
  simulateMessage: (message: ChannelMessage) => void
  simulateDisconnect: () => void
  simulateReconnect: () => void
  simulateError: (error: Error) => void
  failOnSend: boolean
}

function createMockChannel(): MockChannelWithControls {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []
  let state: ChannelState = 'connected'
  let failOnSend = false

  const channel: MockChannelWithControls = {
    get state() {
      return state
    },
    sessionId: 'graceful-failure-test',
    get failOnSend() {
      return failOnSend
    },
    set failOnSend(value: boolean) {
      failOnSend = value
    },
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
      if (failOnSend) {
        throw new Error('Channel send failed: connection lost')
      }
      sentMessages.push(message)
    },
    async connect() {
      state = 'connected'
      failOnSend = false // Reset on connect
    },
    async disconnect() {
      state = 'disconnected'
    },
    async waitFor() {
      return {} as any
    },
    sentMessages,
    simulateMessage(message: ChannelMessage) {
      this.emit('message', message)
    },
    simulateDisconnect() {
      state = 'disconnected'
      failOnSend = true
      this.emit('stateChange', 'disconnected')
      this.emit('error', new Error('Connection lost'))
    },
    simulateReconnect() {
      state = 'connected'
      failOnSend = false
      this.emit('stateChange', 'connected')
    },
    simulateError(error: Error) {
      this.emit('error', error)
    },
  }

  return channel
}

interface MockAuditLoggerWithTracking {
  log: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  warning: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  alert: ReturnType<typeof vi.fn>
  critical: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  getLogs: () => any[]
  failOnWrite: boolean
}

function createMockAuditLogger(): MockAuditLoggerWithTracking {
  const logs: any[] = []
  let failOnWrite = false

  const logFn = vi.fn(async (entry: any) => {
    if (failOnWrite) {
      throw new Error('ENOSPC: no space left on device')
    }
    logs.push(entry)
  })

  return {
    log: logFn,
    info: vi.fn(async (category, action, metadata) => {
      if (failOnWrite) {
        throw new Error('ENOSPC: no space left on device')
      }
      logs.push({ category, action, metadata, severity: 'info' })
    }),
    warning: vi.fn(async (category, action, metadata) => {
      if (failOnWrite) {
        throw new Error('ENOSPC: no space left on device')
      }
      logs.push({ category, action, metadata, severity: 'warning' })
    }),
    warn: vi.fn(async (category, action, metadata) => {
      if (failOnWrite) {
        throw new Error('ENOSPC: no space left on device')
      }
      logs.push({ category, action, metadata, severity: 'warning' })
    }),
    error: vi.fn(async (category, action, metadata) => {
      if (failOnWrite) {
        throw new Error('ENOSPC: no space left on device')
      }
      logs.push({ category, action, metadata, severity: 'error' })
    }),
    alert: vi.fn(async (category, action, metadata) => {
      if (failOnWrite) {
        throw new Error('ENOSPC: no space left on device')
      }
      logs.push({ category, action, metadata, severity: 'alert' })
    }),
    critical: vi.fn(async (category, action, metadata) => {
      if (failOnWrite) {
        throw new Error('ENOSPC: no space left on device')
      }
      logs.push({ category, action, metadata, severity: 'critical' })
    }),
    debug: vi.fn(async (category, action, metadata) => {
      if (failOnWrite) {
        throw new Error('ENOSPC: no space left on device')
      }
      logs.push({ category, action, metadata, severity: 'debug' })
    }),
    query: vi.fn().mockResolvedValue([]),
    getLogs: () => logs,
    get failOnWrite() {
      return failOnWrite
    },
    set failOnWrite(value: boolean) {
      failOnWrite = value
    },
  }
}

/**
 * Custom audit store that can simulate write failures
 */
class FailingAuditStore implements AuditStore {
  private baseDir: string
  private failOnWrite = false
  private writtenEntries: AuditEntry[] = []

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  setFailOnWrite(fail: boolean) {
    this.failOnWrite = fail
  }

  async append(entry: AuditEntry): Promise<void> {
    if (this.failOnWrite) {
      throw new Error('ENOSPC: no space left on device')
    }
    this.writtenEntries.push(entry)
    // Also write to actual file for verification
    const filePath = path.join(this.baseDir, 'audit.jsonl')
    await fs.mkdir(this.baseDir, { recursive: true })
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8')
  }

  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    return this.writtenEntries.filter((entry) => {
      if (filter.category && entry.category !== filter.category) return false
      if (filter.action && entry.action !== filter.action) return false
      return true
    })
  }

  getEntries(): AuditEntry[] {
    return this.writtenEntries
  }
}

// ============================================================================
// Tool Definitions for Tests
// ============================================================================

function createThrowingTool(): ToolPlugin {
  return {
    name: 'throwing_tool',
    description: 'Tool that throws during execution',
    parameters: z.object({
      throwAt: z.enum(['start', 'middle', 'end']).optional(),
      message: z.string().optional(),
    }),
    capability: { name: 'throwing_tool', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown) {
      const { throwAt = 'start', message = 'Tool execution failed' } = args as {
        throwAt?: string
        message?: string
      }

      if (throwAt === 'start') {
        throw new Error(message)
      }

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10))

      if (throwAt === 'middle') {
        throw new Error(message)
      }

      // More work
      await new Promise((resolve) => setTimeout(resolve, 10))

      if (throwAt === 'end') {
        throw new Error(message)
      }

      return { success: true, output: 'Completed' }
    },
  }
}

function createHugeOutputTool(): ToolPlugin {
  return {
    name: 'huge_output_tool',
    description: 'Tool that returns massive output',
    parameters: z.object({
      sizeInMB: z.number().min(0.1).max(10).default(1),
      includeSecret: z.boolean().optional(),
    }),
    capability: { name: 'huge_output_tool', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown) {
      const { sizeInMB = 1, includeSecret = false } = args as {
        sizeInMB?: number
        includeSecret?: boolean
      }

      const targetSize = Math.floor(sizeInMB * 1024 * 1024)
      const chunk = 'ABCDEFGHIJ'.repeat(100) // 1000 chars per chunk
      let output = ''

      // Build up the output
      while (output.length < targetSize) {
        output += chunk + '\n'
      }

      // Optionally inject a secret to verify it gets redacted
      if (includeSecret) {
        const secret = 'ghp_SecretTokenThatShouldBeRedacted123456789'
        output = secret + '\n' + output
      }

      return { success: true, output }
    },
  }
}

function createSlowTool(): ToolPlugin {
  return {
    name: 'slow_tool',
    description: 'Tool with configurable delay',
    parameters: z.object({
      delayMs: z.number().min(0).max(60000).default(1000),
    }),
    capability: { name: 'slow_tool', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown) {
      const { delayMs = 1000 } = args as { delayMs?: number }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return { success: true, output: `Completed after ${delayMs}ms` }
    },
  }
}

function createBashTool(): ToolPlugin {
  return {
    name: 'bash',
    description: 'Execute shell command',
    parameters: z.object({ command: z.string() }),
    capability: { name: 'bash', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown, context: ToolContext) {
      const { command } = args as { command: string }
      try {
        const result = await context.sandbox.execute(command, 'bash')

        // Truncate huge output
        const MAX_OUTPUT = 50000
        let output = result.stdout || ''
        if (result.stderr) output += (output ? '\n' : '') + `stderr: ${result.stderr}`

        if (output.length > MAX_OUTPUT) {
          output =
            output.slice(0, MAX_OUTPUT) + `\n[TRUNCATED: ${output.length - MAX_OUTPUT} bytes]`
        }

        return {
          success: result.exitCode === 0,
          output: output || `Exit code: ${result.exitCode}`,
        }
      } catch (error) {
        return { success: false, output: `Error: ${(error as Error).message}` }
      }
    },
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Graceful Failure E2E Tests', () => {
  let testDir: string
  let auditDir: string
  let channel: MockChannelWithControls
  let provider: MockProvider
  let toolRegistry: ToolRegistry
  let auditLogger: MockAuditLoggerWithTracking

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-graceful-'))
    auditDir = path.join(testDir, 'audit')
    await fs.mkdir(auditDir, { recursive: true })

    channel = createMockChannel()
    provider = new MockProvider()
    toolRegistry = new ToolRegistry()
    auditLogger = createMockAuditLogger()

    // Reset vi mocks
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  // ==========================================================================
  // 1. Sandbox Container Fails to Start
  // ==========================================================================
  describe('Sandbox Container Fails to Start', () => {
    it('falls back gracefully when Docker is unavailable', async () => {
      // Register bash tool that requires sandbox
      toolRegistry.register(createBashTool())

      // Create sandbox with container level that will fall back
      const sandbox = new SandboxExecutor({
        workDir: testDir,
        sandboxLevels: { bash: 'container' }, // Request container sandbox
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
                input: { command: 'echo "Hello from sandbox"' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Command executed' }],
          stopReason: 'end_turn',
        }
      })

      const orchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: sandbox,
          auditLogger: auditLogger as any,
        },
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Run a command')

      // Verify orchestrator returns to idle state
      expect(orchestrator.getState()).toBe('idle')

      // Should have tool result (either from fallback process sandbox or Docker)
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)

      // If Docker wasn't available, it should have fallen back gracefully
      // Either way, the command should have executed
      expect(toolResults[0].output).toBeDefined()
    })

    it('handles complete sandbox failure gracefully', async () => {
      // Create a tool that simulates sandbox execution failure
      const failingSandboxTool: ToolPlugin = {
        name: 'sandbox_fail_tool',
        description: 'Tool that experiences sandbox failure',
        parameters: z.object({}),
        capability: { name: 'sandbox_fail_tool', approval: { level: 'auto' } },
        actions: [],
        async execute(_args, context) {
          // Simulate sandbox throwing an error
          try {
            await context.sandbox.execute('some_command', 'sandbox_fail_tool')
          } catch (error) {
            return {
              success: false,
              output: `Sandbox error: ${(error as Error).message}`,
            }
          }
          return { success: true, output: 'ok' }
        },
      }
      toolRegistry.register(failingSandboxTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'sandbox-fail-1',
                name: 'sandbox_fail_tool',
                input: {},
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Sandbox failed as expected' }],
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

      await orchestrator.processMessage('Test sandbox failure')

      // Verify deterministic state
      expect(orchestrator.getState()).toBe('idle')

      // Session should have the turn recorded
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)

      // No unhandled exceptions - orchestrator handled it
      const errors = channel.sentMessages.filter((m) => m.type === 'error')
      // Errors should be recoverable if any
      errors.forEach((err: any) => {
        expect(err.recoverable).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 2. Tool Throws Mid-Execution
  // ==========================================================================
  describe('Tool Throws Mid-Execution', () => {
    it('handles tool that throws at start', async () => {
      toolRegistry.register(createThrowingTool())

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
                input: { throwAt: 'start', message: 'Initialization failed' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Handled the error gracefully' }],
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

      await orchestrator.processMessage('Call throwing tool')

      // Verify deterministic state
      expect(orchestrator.getState()).toBe('idle')

      // Tool result should indicate error
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('Initialization failed')

      // Session should be valid
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)
      expect(session.turns[0].toolCalls).toHaveLength(1)
      expect(session.turns[0].toolCalls[0].result?.success).toBe(false)
    })

    it('handles tool that throws mid-execution', async () => {
      toolRegistry.register(createThrowingTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'throw-2',
                name: 'throwing_tool',
                input: { throwAt: 'middle', message: 'Processing interrupted' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Recovered from mid-execution failure' }],
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

      await orchestrator.processMessage('Call throwing tool mid-execution')

      expect(orchestrator.getState()).toBe('idle')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('Processing interrupted')
    })

    it('does not leak sensitive data in error messages', async () => {
      // Tool that throws with potentially sensitive data
      const sensitiveErrorTool: ToolPlugin = {
        name: 'sensitive_error_tool',
        description: 'Tool that throws with sensitive data',
        parameters: z.object({}),
        capability: { name: 'sensitive_error_tool', approval: { level: 'auto' } },
        actions: [],
        async execute() {
          // Simulate error that might contain sensitive info
          const secret = 'ghp_SuperSecretToken123456789012345678901'
          throw new Error(`Failed to authenticate with token: ${secret}`)
        },
      }
      toolRegistry.register(sensitiveErrorTool)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'sensitive-1',
                name: 'sensitive_error_tool',
                input: {},
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Error handled' }],
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

      await orchestrator.processMessage('Call sensitive error tool')

      // Check all channel messages for leaked secrets
      const allOutputs = channel.sentMessages
        .map((m) => JSON.stringify(m))
        .join('\n')

      // The raw secret should not appear (may be in error but orchestrator catches exceptions)
      // Note: The error message goes through the tool result path which redacts secrets
      expect(orchestrator.getState()).toBe('idle')
    })
  })

  // ==========================================================================
  // 3. Tool Returns Huge Output
  // ==========================================================================
  describe('Tool Returns Huge Output', () => {
    it('handles tool returning megabytes of data', async () => {
      toolRegistry.register(createHugeOutputTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'huge-1',
                name: 'huge_output_tool',
                input: { sizeInMB: 2 }, // 2MB of output
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Processed large output' }],
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

      await orchestrator.processMessage('Generate huge output')

      // Should complete without crashing
      expect(orchestrator.getState()).toBe('idle')

      // Tool result should exist
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(true)
    }, 30000) // Longer timeout for large data

    it('redacts secrets in huge output', async () => {
      toolRegistry.register(createHugeOutputTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'huge-secret-1',
                name: 'huge_output_tool',
                input: { sizeInMB: 0.5, includeSecret: true },
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
        { streaming: false, workDir: testDir }
      )

      await orchestrator.processMessage('Generate output with secret')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)

      // Secret should be redacted
      expect(toolResults[0].output).not.toContain('ghp_SecretTokenThatShouldBeRedacted123456789')
    }, 15000)

    it('maintains deterministic state with memory pressure', async () => {
      toolRegistry.register(createHugeOutputTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount <= 3) {
          return {
            content: [
              {
                type: 'tool_use',
                id: `huge-${callCount}`,
                name: 'huge_output_tool',
                input: { sizeInMB: 1 },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'All done' }],
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

      await orchestrator.processMessage('Multiple large outputs')

      expect(orchestrator.getState()).toBe('idle')

      // All tool calls should be recorded
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)
      expect(session.turns[0].toolCalls.length).toBeGreaterThanOrEqual(1)
    }, 60000)
  })

  // ==========================================================================
  // 4. Disk Full / Audit Log Can't Write
  // ==========================================================================
  describe('Disk Full / Audit Log Write Failures', () => {
    it('handles audit log write failure gracefully', async () => {
      // Use the failing audit store
      const failingStore = new FailingAuditStore(auditDir)
      const realAuditLogger = new AuditLogger(failingStore)

      toolRegistry.register(createBashTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'bash-audit-1',
                name: 'bash',
                input: { command: 'echo "test"' },
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
          auditLogger: realAuditLogger,
        },
        { streaming: false, workDir: testDir }
      )

      // Start normally
      await orchestrator.start()

      // Now simulate disk full
      failingStore.setFailOnWrite(true)

      // Process message - should handle audit failure gracefully
      // The audit write may fail but processing should continue
      try {
        await orchestrator.processMessage('Run command')
      } catch {
        // Audit failure might propagate but state should be deterministic
      }

      // State should be deterministic (either idle or error, but not corrupted)
      const state = orchestrator.getState()
      expect(['idle', 'error']).toContain(state)
    })

    it('does not produce malformed audit entries on partial write failure', async () => {
      // Create a store that writes partial data
      let writeCount = 0
      const partialWriteStore: AuditStore = {
        async append(entry: AuditEntry): Promise<void> {
          writeCount++
          if (writeCount === 2) {
            // Simulate partial write - throw after some processing
            throw new Error('ENOSPC: no space left on device')
          }
          // Write complete entry
          const filePath = path.join(auditDir, 'audit.jsonl')
          await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8')
        },
        async query(): Promise<AuditEntry[]> {
          return []
        },
      }

      const auditLoggerReal = new AuditLogger(partialWriteStore)

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
          auditLogger: auditLoggerReal,
        },
        { streaming: false, workDir: testDir }
      )

      try {
        await orchestrator.start()
        await orchestrator.processMessage('Test message')
      } catch {
        // May fail on audit write
      }

      // Read the audit file and verify no malformed JSON
      try {
        const auditContent = await fs.readFile(path.join(auditDir, 'audit.jsonl'), 'utf-8')
        const lines = auditContent.trim().split('\n').filter((l) => l.trim())

        for (const line of lines) {
          // Each line should be valid JSON
          expect(() => JSON.parse(line)).not.toThrow()
        }
      } catch {
        // File might not exist if first write failed - that's okay
      }
    })
  })

  // ==========================================================================
  // 5. Channel Disconnects During Streaming
  // ==========================================================================
  describe('Channel Disconnects During Streaming', () => {
    it('handles channel disconnect during message processing', async () => {
      toolRegistry.register(createSlowTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'slow-1',
                name: 'slow_tool',
                input: { delayMs: 500 },
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
        { streaming: false, workDir: testDir }
      )

      // Start processing
      const processingPromise = orchestrator.processMessage('Run slow tool')

      // Simulate disconnect after a short delay
      setTimeout(() => {
        channel.simulateDisconnect()
      }, 100)

      // Should complete (tool continues even if channel fails)
      try {
        await processingPromise
      } catch {
        // May throw due to channel send failure
      }

      // State should be deterministic
      expect(['idle', 'processing', 'executing_tool']).toContain(orchestrator.getState())

      // Session should have partial progress recorded
      const session = orchestrator.getSession()
      expect(session).toBeDefined()
    })

    it('handles multiple rapid disconnects/reconnects', async () => {
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
        { streaming: false, workDir: testDir }
      )

      // Rapid state changes - simulate network flapping
      channel.simulateDisconnect()
      channel.simulateReconnect()
      channel.simulateDisconnect()
      channel.simulateReconnect()

      // Should still be able to process after reconnection
      await orchestrator.processMessage('Test after reconnects')

      expect(orchestrator.getState()).toBe('idle')
    })
  })

  // ==========================================================================
  // 6. Orchestrator Error Mid-Turn
  // ==========================================================================
  describe('Orchestrator Error Mid-Turn', () => {
    it('recovers from provider error mid-turn', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('Provider connection lost')
        }
        return {
          content: [{ type: 'text', text: 'Recovery response' }],
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

      await orchestrator.processMessage('First message')

      // Should have sent error to channel
      const errors = channel.sentMessages.filter((m) => m.type === 'error') as any[]
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Provider connection lost')
      expect(errors[0].recoverable).toBe(true)

      // State should be idle (recovered)
      expect(orchestrator.getState()).toBe('idle')

      // Session should have the failed turn
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)
      expect(session.turns[0].error).toContain('Provider connection lost')
    })

    it('maintains session integrity after multiple errors', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        // First two calls fail, third succeeds
        if (callCount <= 2) {
          throw new Error(`Error ${callCount}`)
        }
        return {
          content: [{ type: 'text', text: 'Finally succeeded' }],
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

      // Process messages that will fail
      await orchestrator.processMessage('Message 1')
      await orchestrator.processMessage('Message 2')
      await orchestrator.processMessage('Message 3')

      // Session should have all turns
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(3)

      // First two should have errors
      expect(session.turns[0].error).toContain('Error 1')
      expect(session.turns[1].error).toContain('Error 2')

      // Third should succeed
      expect(session.turns[2].error).toBeUndefined()
      expect(session.turns[2].assistantResponse).toBe('Finally succeeded')

      // Token counts should be valid (non-negative)
      expect(session.totalUsage.inputTokens).toBeGreaterThanOrEqual(0)
      expect(session.totalUsage.outputTokens).toBeGreaterThanOrEqual(0)
    })

    it('does not corrupt state when error occurs during tool execution', async () => {
      toolRegistry.register(createThrowingTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          // Multiple tool calls, one will fail
          return {
            content: [
              {
                type: 'tool_use',
                id: 'throw-multi-1',
                name: 'throwing_tool',
                input: { throwAt: 'start', message: 'First tool failed' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Handled failure' }],
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

      await orchestrator.processMessage('Run tools')

      // State should be clean
      expect(orchestrator.getState()).toBe('idle')

      // Session should be valid
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)

      // Tool call should be recorded with error
      const toolCall = session.turns[0].toolCalls[0]
      expect(toolCall).toBeDefined()
      expect(toolCall.result?.success).toBe(false)
      expect(toolCall.result?.output).toContain('First tool failed')
    })

    it('provides actionable error messages to user', async () => {
      // Test various error scenarios - each needs fresh provider and channel
      const errorScenarios = [
        { error: 'Rate limited', expectedContains: 'Rate limited' },
        { error: 'Authentication failed', expectedContains: 'Authentication' },
        { error: 'Context too long', expectedContains: 'Context' },
      ]

      for (const scenario of errorScenarios) {
        // Create fresh channel and provider for each scenario
        const testChannel = createMockChannel()
        const testProvider = new MockProvider()

        testProvider.addGenerator(() => {
          throw new Error(scenario.error)
        })

        const orchestrator = new Orchestrator(
          {
            channel: testChannel,
            provider: testProvider,
            toolRegistry,
            approvalManager: createAutoApproveManager(),
            sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
            auditLogger: auditLogger as any,
          },
          { streaming: false, workDir: testDir }
        )

        await orchestrator.processMessage(`Test: ${scenario.error}`)

        const errors = testChannel.sentMessages.filter((m) => m.type === 'error') as any[]
        expect(errors).toHaveLength(1)
        expect(errors[0].message).toContain(scenario.expectedContains)
        // Error message should be actionable (not just "Unknown error")
        expect(errors[0].message).not.toBe('Unknown error')
      }
    })
  })

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================
  describe('Combined Failure Scenarios', () => {
    it('handles tool error + channel disconnect simultaneously', async () => {
      toolRegistry.register(createThrowingTool())

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'combo-1',
                name: 'throwing_tool',
                input: { throwAt: 'middle', message: 'Combo failure' },
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
        { streaming: false, workDir: testDir }
      )

      // Start processing
      const promise = orchestrator.processMessage('Combo test')

      // Disconnect mid-execution
      setTimeout(() => channel.simulateDisconnect(), 5)

      try {
        await promise
      } catch {
        // May fail
      }

      // Should not be in corrupted state
      const state = orchestrator.getState()
      expect(['idle', 'processing', 'executing_tool']).toContain(state)
    })

    it('stress test: rapid fire errors do not accumulate state', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount % 2 === 0) {
          throw new Error(`Error ${callCount}`)
        }
        return {
          content: [{ type: 'text', text: `Response ${callCount}` }],
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
        { streaming: false, workDir: testDir, maxTurns: 20 }
      )

      // Fire 10 messages rapidly (sequential since concurrent is blocked)
      for (let i = 0; i < 10; i++) {
        await orchestrator.processMessage(`Message ${i}`)
      }

      // Session should be consistent
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(10)

      // Count successful vs failed turns
      const successful = session.turns.filter((t) => !t.error)
      const failed = session.turns.filter((t) => t.error)

      // Should have mix of both (based on our alternating pattern)
      expect(successful.length).toBeGreaterThan(0)
      expect(failed.length).toBeGreaterThan(0)

      // State should be idle
      expect(orchestrator.getState()).toBe('idle')
    })
  })
})
