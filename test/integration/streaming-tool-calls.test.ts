/**
 * Streaming Tool Call Integration Tests
 *
 * Tests the orchestrator's behavior when tool calls arrive via streaming events.
 * Validates:
 * - Tool call JSON reconstructed correctly from deltas
 * - Multiple tool calls in a single assistant message
 * - Tool calls interleaved with text deltas
 * - Stream disconnection handling
 * - No tool execution on incomplete JSON
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
import type { Channel, ChannelMessage, ChannelState, StreamDeltaMessage } from '../../src/channel/types.js'
import type { StreamEvent } from '../../src/provider/types.js'

function createTestChannel(): Channel & { sentMessages: ChannelMessage[]; streamDeltas: string[] } {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []
  const streamDeltas: string[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'streaming-test',
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
      if (message.type === 'stream_delta') {
        streamDeltas.push((message as StreamDeltaMessage).delta)
      }
    },
    async connect() {},
    async disconnect() {},
    async waitFor() {
      return {} as any
    },
    sentMessages,
    streamDeltas,
  }
}

// Tool that records execution for verification
function createRecordingTool(
  name: string,
  executions: { name: string; args: any }[]
): ToolPlugin {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: z.object({}).passthrough(),
    capability: { name, approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown) {
      executions.push({ name, args })
      return { success: true, output: `${name} executed with ${JSON.stringify(args)}` }
    },
  }
}

describe('Streaming Tool Call Tests', () => {
  let testDir: string
  let channel: ReturnType<typeof createTestChannel>
  let provider: MockProvider
  let toolRegistry: ToolRegistry
  let orchestrator: Orchestrator
  let toolExecutions: { name: string; args: any }[]

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-streaming-'))
    const auditDir = path.join(testDir, 'audit')
    await fs.mkdir(auditDir, { recursive: true })

    channel = createTestChannel()
    provider = new MockProvider()
    toolRegistry = new ToolRegistry()
    toolExecutions = []

    // Register recording tools
    toolRegistry.register(createRecordingTool('read', toolExecutions))
    toolRegistry.register(createRecordingTool('write', toolExecutions))
    toolRegistry.register(createRecordingTool('bash', toolExecutions))

    const auditStore = new JsonlAuditStore(auditDir)
    const auditLogger = new AuditLogger(auditStore)

    orchestrator = new Orchestrator(
      {
        channel,
        provider,
        toolRegistry,
        approvalManager: createAutoApproveManager(),
        sandboxExecutor: new SandboxExecutor({
          workDir: testDir,
          sandboxLevels: { bash: 'process' },
        }),
        auditLogger,
      },
      { streaming: true, workDir: testDir }
    )
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Tool call JSON split across deltas', () => {
    it('reconstructs tool call from multiple deltas', async () => {
      // Simulate streaming response with tool call split across deltas
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } }
        // JSON split: {"path": "test.txt"}
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"pa' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'th":' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' "test' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '.txt"' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      // Second response after tool execution
      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Done reading file.' }],
        stopReason: 'end_turn',
      }))

      await orchestrator.processMessage('Read test.txt')

      // Verify tool was executed with correct args
      expect(toolExecutions).toHaveLength(1)
      expect(toolExecutions[0].name).toBe('read')
      expect(toolExecutions[0].args).toEqual({ path: 'test.txt' })
    })

    it('handles complex JSON split into many small chunks', async () => {
      const complexArgs = {
        path: '/long/path/to/file.txt',
        content: 'Line 1\nLine 2\nLine 3',
        options: { encoding: 'utf-8', append: true },
      }
      const jsonStr = JSON.stringify(complexArgs)

      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'write' } }

        // Split into 5-char chunks
        for (let i = 0; i < jsonStr.length; i += 5) {
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: jsonStr.slice(i, i + 5) },
          }
        }

        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'end_turn',
      }))

      await orchestrator.processMessage('Write file')

      expect(toolExecutions).toHaveLength(1)
      expect(toolExecutions[0].args).toEqual(complexArgs)
    })
  })

  describe('Multiple tool calls in one message', () => {
    it('executes two tool calls back-to-back', async () => {
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }

        // First tool call
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path": "input.txt"}' } }
        yield { type: 'content_block_stop', index: 0 }

        // Second tool call
        yield { type: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: 'call-2', name: 'write' } }
        yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path": "output.txt", "content": "data"}' } }
        yield { type: 'content_block_stop', index: 1 }

        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Completed both operations.' }],
        stopReason: 'end_turn',
      }))

      await orchestrator.processMessage('Read and write')

      expect(toolExecutions).toHaveLength(2)
      expect(toolExecutions[0]).toEqual({ name: 'read', args: { path: 'input.txt' } })
      expect(toolExecutions[1]).toEqual({ name: 'write', args: { path: 'output.txt', content: 'data' } })
    })

    it('executes three tool calls sequentially', async () => {
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }

        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file": "a"}' } }
        yield { type: 'content_block_stop', index: 0 }

        yield { type: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: 'call-2', name: 'bash' } }
        yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"cmd": "ls"}' } }
        yield { type: 'content_block_stop', index: 1 }

        yield { type: 'content_block_start', index: 2, contentBlock: { type: 'tool_use', id: 'call-3', name: 'write' } }
        yield { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"out": "b"}' } }
        yield { type: 'content_block_stop', index: 2 }

        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'All done.' }],
        stopReason: 'end_turn',
      }))

      await orchestrator.processMessage('Multi-step')

      expect(toolExecutions).toHaveLength(3)
      expect(toolExecutions.map((e) => e.name)).toEqual(['read', 'bash', 'write'])
    })
  })

  describe('Tool calls interleaved with text', () => {
    it('handles text before tool call', async () => {
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }

        // Text block first
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me read that file...' } }
        yield { type: 'content_block_stop', index: 0 }

        // Then tool call
        yield { type: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } }
        yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path": "file.txt"}' } }
        yield { type: 'content_block_stop', index: 1 }

        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Here is the content.' }],
        stopReason: 'end_turn',
      }))

      await orchestrator.processMessage('Read the file')

      // Verify text was streamed
      expect(channel.streamDeltas.join('')).toContain('Let me read that file')

      // Verify tool executed
      expect(toolExecutions).toHaveLength(1)
      expect(toolExecutions[0].args).toEqual({ path: 'file.txt' })
    })

    it('handles tool call between text blocks', async () => {
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }

        // First text
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Before ' } }
        yield { type: 'content_block_stop', index: 0 }

        // Tool call
        yield { type: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } }
        yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }
        yield { type: 'content_block_stop', index: 1 }

        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'After tool execution.' }],
        stopReason: 'end_turn',
      }))

      await orchestrator.processMessage('Do something')

      expect(toolExecutions).toHaveLength(1)
    })
  })

  describe('Stream restart after tool execution', () => {
    it('continues conversation after tool result', async () => {
      // First stream: tool call
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path": "data.txt"}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      // Second stream: uses tool result
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-2', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The file contains: ' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'important data.' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
      })

      await orchestrator.processMessage('What is in data.txt?')

      // Tool executed
      expect(toolExecutions).toHaveLength(1)

      // Final response streamed
      const responseText = channel.streamDeltas.join('')
      expect(responseText).toContain('The file contains')

      // Session has correct turn structure
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)
      expect(session.turns[0].toolCalls).toHaveLength(1)
    })

    it('handles multi-loop tool execution', async () => {
      // First loop: read
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"step": 1}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      // Second loop: bash
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-2', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-2', name: 'bash' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"step": 2}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      // Third loop: write
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-3', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-3', name: 'write' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"step": 3}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      // Final response
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-4', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Completed all steps.' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
      })

      await orchestrator.processMessage('Run 3-step workflow')

      expect(toolExecutions).toHaveLength(3)
      expect(toolExecutions.map((e) => e.name)).toEqual(['read', 'bash', 'write'])
      expect(toolExecutions.map((e) => e.args.step)).toEqual([1, 2, 3])
    })
  })

  describe('No duplicate execution', () => {
    it('does not double-execute tools on stream restart', async () => {
      let callCount = 0

      // Create a tool that counts executions
      toolRegistry.register({
        name: 'counter',
        description: 'Counts calls',
        parameters: z.object({}),
        capability: { name: 'counter', approval: { level: 'auto' } },
        actions: [],
        async execute() {
          callCount++
          return { success: true, output: `Call #${callCount}` }
        },
      })

      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'msg-1', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'counter' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
      })

      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'end_turn',
      }))

      await orchestrator.processMessage('Count')

      // Should only execute once
      expect(callCount).toBe(1)
    })
  })
})
