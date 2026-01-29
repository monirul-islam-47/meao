import { describe, it, expect, beforeEach, vi } from 'vitest'
import { z } from 'zod'
import { Orchestrator } from '../../src/orchestrator/orchestrator.js'
import { MockProvider } from '../../src/provider/mock.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { ApprovalManager, createAutoApproveManager } from '../../src/tools/approvals.js'
import { SandboxExecutor } from '../../src/sandbox/executor.js'
import type { ToolPlugin, ToolContext } from '../../src/tools/types.js'
import type { Channel, ChannelMessage, ChannelState } from '../../src/channel/types.js'

// Create mock channel
function createMockChannel(): Channel & {
  sentMessages: ChannelMessage[]
  simulateMessage: (message: ChannelMessage) => void
} {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'test-session',

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

// Create mock audit logger
function createMockAuditLogger() {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
  }
}

// Create test tool
function createTestTool(name: string): ToolPlugin {
  return {
    name,
    description: `Test tool ${name}`,
    parameters: z.object({
      input: z.string().optional(),
    }),
    capability: {
      name,
      approval: { level: 'auto' },
    },
    actions: [],
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: `${name} executed`,
    }),
  }
}

describe('Orchestrator', () => {
  let orchestrator: Orchestrator
  let channel: ReturnType<typeof createMockChannel>
  let provider: MockProvider
  let toolRegistry: ToolRegistry
  let auditLogger: ReturnType<typeof createMockAuditLogger>

  beforeEach(() => {
    channel = createMockChannel()
    provider = new MockProvider()
    toolRegistry = new ToolRegistry()
    auditLogger = createMockAuditLogger()

    // Register a test tool
    toolRegistry.register(createTestTool('test_tool'))

    orchestrator = new Orchestrator(
      {
        channel,
        provider,
        toolRegistry,
        approvalManager: createAutoApproveManager(),
        sandboxExecutor: new SandboxExecutor({
          forceProcessSandbox: true,
        }),
        auditLogger: auditLogger as any,
      },
      {
        streaming: false,
        model: 'test-model',
      }
    )
  })

  describe('basic functionality', () => {
    it('starts in idle state', () => {
      expect(orchestrator.getState()).toBe('idle')
    })

    it('creates session on construction', () => {
      const session = orchestrator.getSession()
      expect(session.id).toBeDefined()
      expect(session.turns).toHaveLength(0)
      expect(session.messages).toHaveLength(0)
    })

    it('starts and connects channel', async () => {
      const connectSpy = vi.spyOn(channel, 'connect')
      await orchestrator.start()
      expect(connectSpy).toHaveBeenCalled()
    })

    it('stops and disconnects channel', async () => {
      const disconnectSpy = vi.spyOn(channel, 'disconnect')
      await orchestrator.stop()
      expect(disconnectSpy).toHaveBeenCalled()
    })
  })

  describe('message processing', () => {
    it('processes user message', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Hello, human!' }],
        stopReason: 'end_turn',
      })

      await orchestrator.processMessage('Hello')

      // Check that assistant message was sent
      const assistantMessages = channel.sentMessages.filter(
        (m) => m.type === 'assistant_message'
      )
      expect(assistantMessages).toHaveLength(1)
    })

    it('adds messages to session', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      await orchestrator.processMessage('Hello')

      const session = orchestrator.getSession()
      expect(session.messages).toHaveLength(2)
      expect(session.messages[0]).toEqual({
        role: 'user',
        content: 'Hello',
      })
    })

    it('creates turn for each message', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      await orchestrator.processMessage('First')
      await orchestrator.processMessage('Second')

      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(2)
      expect(session.turns[0].userMessage).toBe('First')
      expect(session.turns[1].userMessage).toBe('Second')
    })

    it('tracks token usage', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      await orchestrator.processMessage('Hello')

      const session = orchestrator.getSession()
      expect(session.totalUsage.inputTokens).toBeGreaterThan(0)
      expect(session.totalUsage.outputTokens).toBeGreaterThan(0)
    })
  })

  describe('tool execution', () => {
    it('executes tool when model requests', async () => {
      const testTool = toolRegistry.get('test_tool')!

      // Use call count to switch responses
      let callCount = 0
      provider.reset()
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          // First call: tool use
          return {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'test_tool',
                input: { input: 'test' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        // Subsequent calls: end turn
        return {
          content: [{ type: 'text', text: 'Tool was executed!' }],
          stopReason: 'end_turn',
        }
      })

      await orchestrator.processMessage('Run the tool')

      expect(testTool.execute).toHaveBeenCalled()

      // Check tool result was sent
      const toolResults = channel.sentMessages.filter(
        (m) => m.type === 'tool_result'
      )
      expect(toolResults).toHaveLength(1)
    })

    it('handles tool errors gracefully', async () => {
      // Need to create a fresh orchestrator for this test with the error tool
      const errorChannel = createMockChannel()
      const errorProvider = new MockProvider()
      const errorToolRegistry = new ToolRegistry()
      const errorAuditLogger = createMockAuditLogger()

      const errorTool: ToolPlugin = {
        name: 'error_tool',
        description: 'Tool that errors',
        parameters: z.object({}),
        capability: {
          name: 'error_tool',
          approval: { level: 'auto' },
        },
        actions: [],
        execute: vi.fn().mockRejectedValue(new Error('Tool failed')),
      }
      errorToolRegistry.register(errorTool)

      const errorOrchestrator = new Orchestrator(
        {
          channel: errorChannel,
          provider: errorProvider,
          toolRegistry: errorToolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ forceProcessSandbox: true }),
          auditLogger: errorAuditLogger as any,
        },
        {
          streaming: false,
          model: 'test-model',
        }
      )

      // Use call count to switch responses
      let callCount = 0
      errorProvider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          // First call: tool use
          return {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'error_tool',
                input: {},
              },
            ],
            stopReason: 'tool_use',
          }
        }
        // Subsequent calls: end turn
        return {
          content: [{ type: 'text', text: 'Error handled' }],
          stopReason: 'end_turn',
        }
      })

      await errorOrchestrator.processMessage('Run error tool')

      // Check tool was called
      expect(errorTool.execute).toHaveBeenCalled()

      // Check tool result was sent with error
      const toolResults = errorChannel.sentMessages.filter(
        (m) => m.type === 'tool_result'
      ) as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
    })
  })

  describe('channel message handling', () => {
    it('processes user message from channel', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      // Start orchestrator to set up listeners
      await orchestrator.start()

      // Simulate user message from channel
      channel.simulateMessage({
        type: 'user_message',
        id: 'msg-1',
        timestamp: new Date(),
        sessionId: 'test',
        content: 'Hello from channel',
      })

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)
    })
  })

  describe('session management', () => {
    it('estimates cost', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      await orchestrator.processMessage('Hello')

      const session = orchestrator.getSession()
      expect(session.estimatedCost).toBeGreaterThan(0)
    })

    it('respects max turns limit', async () => {
      const limitedOrchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: createAutoApproveManager(),
          sandboxExecutor: new SandboxExecutor({ forceProcessSandbox: true }),
          auditLogger: auditLogger as any,
        },
        {
          streaming: false,
          maxTurns: 2,
        }
      )

      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      await limitedOrchestrator.processMessage('Turn 1')
      await limitedOrchestrator.processMessage('Turn 2')
      await limitedOrchestrator.processMessage('Turn 3')

      const session = limitedOrchestrator.getSession()
      expect(session.turns).toHaveLength(2)

      // Check error was sent
      const errors = channel.sentMessages.filter((m) => m.type === 'error') as any[]
      expect(errors.some((e) => e.code === 'max_turns_exceeded')).toBe(true)
    })
  })

  describe('state management', () => {
    it('emits state change events', async () => {
      const states: string[] = []
      orchestrator.on('stateChange' as any, (state: string) => states.push(state))

      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      await orchestrator.processMessage('Hello')

      expect(states).toContain('processing')
      expect(states).toContain('idle')
    })

    it('prevents concurrent message processing', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
        delay: 100,
      })

      // Start first message (will be processing)
      const first = orchestrator.processMessage('First')

      // Try second message immediately
      await expect(
        orchestrator.processMessage('Second')
      ).rejects.toThrow(/Cannot process message/)

      await first
    })
  })
})
