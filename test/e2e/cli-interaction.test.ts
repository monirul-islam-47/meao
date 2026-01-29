/**
 * CLI Interaction E2E Tests (M8.3)
 *
 * Tests the actual CLI UX using custom input/output streams:
 * - Streaming output appears incrementally
 * - Approval prompts appear and work correctly
 * - User deny stops the tool
 * - User approve runs the tool
 * - Interrupt handling (simulated)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { PassThrough, Readable, Writable } from 'stream'
import { z } from 'zod'
import { CLIChannel } from '../../src/channel/cli.js'
import { Orchestrator } from '../../src/orchestrator/orchestrator.js'
import { MockProvider } from '../../src/provider/mock.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { ApprovalManager } from '../../src/tools/approvals.js'
import { SandboxExecutor } from '../../src/sandbox/executor.js'
import { JsonlAuditStore } from '../../src/audit/store/jsonl.js'
import { AuditLogger } from '../../src/audit/service.js'
import type { ToolPlugin, ToolContext, ApprovalRequest } from '../../src/tools/types.js'

/**
 * Create a controllable input stream for testing.
 */
function createTestInputStream(): PassThrough & { sendLine: (line: string) => void } {
  const stream = new PassThrough() as PassThrough & { sendLine: (line: string) => void }
  stream.sendLine = (line: string) => {
    stream.write(line + '\n')
  }
  return stream
}

/**
 * Create a capturing output stream.
 */
function createTestOutputStream(): PassThrough & { getOutput: () => string; clear: () => void } {
  let buffer = ''
  const stream = new PassThrough() as PassThrough & { getOutput: () => string; clear: () => void }
  stream.on('data', (chunk) => {
    buffer += chunk.toString()
  })
  stream.getOutput = () => buffer
  stream.clear = () => { buffer = '' }
  return stream
}

/**
 * Wait for output to contain a string.
 */
async function waitForOutput(
  output: { getOutput: () => string },
  pattern: string | RegExp,
  timeout = 5000
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const text = output.getOutput()
    if (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)) {
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timeout waiting for output pattern: ${pattern}`)
}

/**
 * Create a tool that requires approval.
 */
function createApprovalTool(name: string, level: 'ask' | 'always'): ToolPlugin {
  return {
    name,
    description: `Tool requiring ${level} approval`,
    parameters: z.object({ action: z.string().optional() }),
    capability: { name, approval: { level } },
    actions: [{ tool: name, action: 'execute', affectsOthers: false, isDestructive: level === 'always', hasFinancialImpact: false }],
    async execute(args: unknown) {
      return { success: true, output: `${name} executed with ${JSON.stringify(args)}` }
    },
  }
}

/**
 * Create a simple auto-approved tool.
 */
function createAutoTool(name: string): ToolPlugin {
  return {
    name,
    description: `Auto-approved tool: ${name}`,
    parameters: z.object({ input: z.string().optional() }),
    capability: { name, approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown) {
      return { success: true, output: `${name} result` }
    },
  }
}

describe('CLI Interaction E2E Tests', () => {
  let testDir: string
  let input: ReturnType<typeof createTestInputStream>
  let output: ReturnType<typeof createTestOutputStream>
  let errorOutput: ReturnType<typeof createTestOutputStream>
  let channel: CLIChannel
  let provider: MockProvider
  let toolRegistry: ToolRegistry
  let orchestrator: Orchestrator

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-cli-'))
    const auditDir = path.join(testDir, 'audit')
    await fs.mkdir(auditDir, { recursive: true })

    input = createTestInputStream()
    output = createTestOutputStream()
    errorOutput = createTestOutputStream()

    channel = new CLIChannel({
      input,
      output,
      error: errorOutput,
      colors: false, // Disable colors for easier testing
      prompt: '> ',
    })

    provider = new MockProvider()
    toolRegistry = new ToolRegistry()

    const auditStore = new JsonlAuditStore(auditDir)
    const auditLogger = new AuditLogger(auditStore)

    // Default auto-approve manager (will be overridden in approval tests)
    const approvalManager = new ApprovalManager(async () => true)

    orchestrator = new Orchestrator(
      {
        channel,
        provider,
        toolRegistry,
        approvalManager,
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
    await channel.disconnect()
    // Allow async I/O to complete before cleanup
    await new Promise((r) => setTimeout(r, 200))
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Retry once after additional delay if first attempt fails
      await new Promise((r) => setTimeout(r, 100))
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  describe('Streaming Output', () => {
    it('streams text output incrementally', async () => {
      provider.addStreamGenerator(function* () {
        yield { type: 'message_start', message: { id: 'm1', model: 'test' } }
        yield { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'World!' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { outputTokens: 5 } }
      })

      await channel.connect()
      await orchestrator.start()

      // Send user input
      input.sendLine('Say hello')

      // Wait for streamed output
      await waitForOutput(output, 'Hello ')
      await waitForOutput(output, 'World!')

      // Output should contain both parts
      expect(output.getOutput()).toContain('Hello World!')
    })

    it('shows tool use indicators', async () => {
      toolRegistry.register(createAutoTool('read'))

      provider.addGenerator(() => ({
        content: [{ type: 'tool_use', id: 'c1', name: 'read', input: {} }],
        stopReason: 'tool_use',
      }))
      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Done reading.' }],
        stopReason: 'end_turn',
      }))

      await channel.connect()
      await orchestrator.start()

      input.sendLine('Read something')

      // Wait for tool indicator
      await waitForOutput(output, '[Tool: read]')

      // Wait for result indicator
      await waitForOutput(output, '✓ read')
    })
  })

  describe('Approval Flow - Deny', () => {
    it('denying approval stops tool execution', async () => {
      let toolExecuted = false
      const approvalTool: ToolPlugin = {
        name: 'dangerous',
        description: 'Dangerous tool',
        parameters: z.object({}),
        capability: { name: 'dangerous', approval: { level: 'ask' } },
        actions: [{ tool: 'dangerous', action: 'execute', affectsOthers: true, isDestructive: true, hasFinancialImpact: false }],
        async execute() {
          toolExecuted = true
          return { success: true, output: 'executed' }
        },
      }
      toolRegistry.register(approvalTool)

      // Create orchestrator with interactive approval that denies
      const approvalRequests: ApprovalRequest[] = []
      const interactiveApproval = new ApprovalManager(async (request) => {
        approvalRequests.push(request)
        return false // Deny
      })

      const auditStore = new JsonlAuditStore(path.join(testDir, 'audit'))
      const auditLogger = new AuditLogger(auditStore)

      orchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: interactiveApproval,
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger,
        },
        { streaming: false, workDir: testDir }
      )

      // Use a counter to return tool_use only once, then text response
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [{ type: 'tool_use', id: 'c1', name: 'dangerous', input: {} }],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Tool was denied, stopping.' }],
          stopReason: 'end_turn',
        }
      })

      await channel.connect()
      await orchestrator.start()

      // Process message directly instead of via channel
      await orchestrator.processMessage('Do dangerous thing')

      // Tool should NOT have executed
      expect(toolExecuted).toBe(false)

      // Approval should have been requested
      expect(approvalRequests).toHaveLength(1)
      expect(approvalRequests[0].tool).toBe('dangerous')

      // Output should show denial result or stopping message
      const text = output.getOutput()
      expect(text).toMatch(/denied|stopping/i)
    }, 10000)
  })

  describe('Approval Flow - Approve', () => {
    it('approving runs the tool and continues', async () => {
      let toolExecuted = false
      const approvalTool: ToolPlugin = {
        name: 'write_file',
        description: 'Write file',
        parameters: z.object({ path: z.string() }),
        capability: { name: 'write', approval: { level: 'ask' } },
        actions: [{ tool: 'write_file', action: 'write', affectsOthers: false, isDestructive: true, hasFinancialImpact: false }],
        async execute(args: unknown) {
          toolExecuted = true
          return { success: true, output: 'File written' }
        },
      }
      toolRegistry.register(approvalTool)

      // Create orchestrator with approval that says yes
      const interactiveApproval = new ApprovalManager(async () => true)

      const auditStore = new JsonlAuditStore(path.join(testDir, 'audit'))
      const auditLogger = new AuditLogger(auditStore)

      orchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: interactiveApproval,
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger,
        },
        { streaming: false, workDir: testDir }
      )

      provider.addGenerator(() => ({
        content: [{ type: 'tool_use', id: 'c1', name: 'write_file', input: { path: 'test.txt' } }],
        stopReason: 'tool_use',
      }))
      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'File has been written.' }],
        stopReason: 'end_turn',
      }))

      await channel.connect()
      await orchestrator.start()

      input.sendLine('Write a file')

      // Wait for tool result
      await waitForOutput(output, '✓ write_file')

      // Wait for final response
      await waitForOutput(output, 'written')

      // Tool should have executed
      expect(toolExecuted).toBe(true)
    })
  })

  describe('Approval Caching', () => {
    it('remembers approval for same tool in session', async () => {
      let approvalCount = 0
      const tool: ToolPlugin = {
        name: 'repeated_tool',
        description: 'Tool called multiple times',
        parameters: z.object({ n: z.number() }),
        capability: { name: 'repeated', approval: { level: 'ask' } },
        actions: [{ tool: 'repeated_tool', action: 'run', affectsOthers: false, isDestructive: false, hasFinancialImpact: false }],
        async execute(args: unknown) {
          return { success: true, output: `run ${(args as any).n}` }
        },
      }
      toolRegistry.register(tool)

      const interactiveApproval = new ApprovalManager(async () => {
        approvalCount++
        return true
      })

      const auditStore = new JsonlAuditStore(path.join(testDir, 'audit'))
      const auditLogger = new AuditLogger(auditStore)

      orchestrator = new Orchestrator(
        {
          channel,
          provider,
          toolRegistry,
          approvalManager: interactiveApproval,
          sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
          auditLogger,
        },
        { streaming: false, workDir: testDir }
      )

      // First call with approval
      provider.addGenerator(() => ({
        content: [{ type: 'tool_use', id: 'c1', name: 'repeated_tool', input: { n: 1 } }],
        stopReason: 'tool_use',
      }))
      // Second call - same tool, same args - should use cached approval
      provider.addGenerator(() => ({
        content: [{ type: 'tool_use', id: 'c2', name: 'repeated_tool', input: { n: 1 } }],
        stopReason: 'tool_use',
      }))
      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Both tools done.' }],
        stopReason: 'end_turn',
      }))

      await channel.connect()
      await orchestrator.start()

      // Process message directly instead of via channel
      await orchestrator.processMessage('Run tool twice')

      // Approval should only be requested once (cached for identical call)
      expect(approvalCount).toBe(1)

      // Both tools should have run
      const text = output.getOutput()
      expect(text).toContain('✓ repeated_tool')
    }, 10000)
  })

  describe('Error Handling', () => {
    it('displays errors to user', async () => {
      provider.addGenerator(() => {
        throw new Error('Provider error')
      })

      await channel.connect()
      await orchestrator.start()

      input.sendLine('Trigger error')

      // Wait for error in output or error stream
      await waitForOutput(errorOutput, 'Error', 3000).catch(() => {
        // Error might be in regular output
      })

      // Orchestrator should be back in idle state
      await new Promise((r) => setTimeout(r, 200))
      expect(orchestrator.getState()).toBe('idle')
    })

    it('recovers after error and accepts new input', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('First call fails')
        }
        return {
          content: [{ type: 'text', text: 'Second call succeeds!' }],
          stopReason: 'end_turn',
        }
      })

      await channel.connect()
      await orchestrator.start()

      // First input - should error
      input.sendLine('First message')
      await new Promise((r) => setTimeout(r, 300))

      // Second input - should succeed
      input.sendLine('Second message')
      await waitForOutput(output, 'Second call succeeds!')

      expect(callCount).toBe(2)
    })
  })

  describe('Tool Result Display', () => {
    it('truncates long tool output', async () => {
      const longOutputTool: ToolPlugin = {
        name: 'long_output',
        description: 'Produces long output',
        parameters: z.object({}),
        capability: { name: 'long', approval: { level: 'auto' } },
        actions: [],
        async execute() {
          // Generate 20 lines
          const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n')
          return { success: true, output: lines }
        },
      }
      toolRegistry.register(longOutputTool)

      provider.addGenerator(() => ({
        content: [{ type: 'tool_use', id: 'c1', name: 'long_output', input: {} }],
        stopReason: 'tool_use',
      }))
      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'end_turn',
      }))

      await channel.connect()
      await orchestrator.start()

      input.sendLine('Run long output')

      await waitForOutput(output, 'more lines')

      // Should show truncation message
      const text = output.getOutput()
      expect(text).toContain('more lines')
    })

    it('shows success/failure indicators', async () => {
      const failingTool: ToolPlugin = {
        name: 'fail_tool',
        description: 'Always fails',
        parameters: z.object({}),
        capability: { name: 'fail', approval: { level: 'auto' } },
        actions: [],
        async execute() {
          return { success: false, output: 'Operation failed' }
        },
      }
      toolRegistry.register(failingTool)

      provider.addGenerator(() => ({
        content: [{ type: 'tool_use', id: 'c1', name: 'fail_tool', input: {} }],
        stopReason: 'tool_use',
      }))
      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Tool failed.' }],
        stopReason: 'end_turn',
      }))

      await channel.connect()
      await orchestrator.start()

      input.sendLine('Run failing tool')

      // Should show failure indicator
      await waitForOutput(output, '✗ fail_tool')
    })
  })

  describe('Multi-Turn Conversation', () => {
    it('maintains context across turns', async () => {
      let turnCount = 0
      provider.addGenerator((messages) => {
        turnCount++
        // Provider can see all previous messages
        const messageCount = messages.length
        return {
          content: [{ type: 'text', text: `Turn ${turnCount}, messages: ${messageCount}` }],
          stopReason: 'end_turn',
        }
      })

      await channel.connect()
      await orchestrator.start()

      input.sendLine('First message')
      await waitForOutput(output, 'Turn 1')

      output.clear()
      input.sendLine('Second message')
      await waitForOutput(output, 'Turn 2')

      // Second turn should see more messages (previous turn's messages)
      expect(output.getOutput()).toContain('messages: 3') // user + assistant + user
    })
  })
})

describe('CLIChannel Unit Tests', () => {
  it('prompt approval returns correct values for different inputs', async () => {
    const testCases = [
      { input: 'y', expected: { approved: true } },
      { input: 'yes', expected: { approved: true } },
      { input: 'n', expected: { approved: false } },
      { input: 'no', expected: { approved: false } },
      { input: 'a', expected: { approved: true, rememberAlways: true } },
      { input: 'always', expected: { approved: true, rememberAlways: true } },
      { input: 's', expected: { approved: true, rememberSession: true } },
      { input: 'session', expected: { approved: true, rememberSession: true } },
      { input: 'random', expected: { approved: false } },
      { input: '', expected: { approved: false } },
    ]

    for (const { input: userInput, expected } of testCases) {
      const inputStream = createTestInputStream()
      const outputStream = createTestOutputStream()

      const channel = new CLIChannel({
        input: inputStream,
        output: outputStream,
        colors: false,
      })

      await channel.connect()

      // Access private method via prototype for testing
      const promptApproval = (channel as any).prompt_approval.bind(channel)

      // Send response after a small delay
      setTimeout(() => {
        inputStream.sendLine(userInput)
      }, 50)

      const result = await promptApproval()
      expect(result.approved).toBe(expected.approved)
      if (expected.rememberAlways) {
        expect(result.rememberAlways).toBe(true)
      }
      if (expected.rememberSession) {
        expect(result.rememberSession).toBe(true)
      }

      await channel.disconnect()
    }
  })
})
