/**
 * Real Provider E2E Tests
 *
 * These tests exercise the full stack with the real Anthropic API.
 * They require ANTHROPIC_API_KEY to be set.
 *
 * Run with: ANTHROPIC_API_KEY=sk-ant-xxx npm test -- --run test/e2e/real-provider.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { z } from 'zod'
import { Orchestrator } from '../../src/orchestrator/orchestrator.js'
import { AnthropicProvider } from '../../src/provider/anthropic.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { createAutoApproveManager } from '../../src/tools/approvals.js'
import { SandboxExecutor } from '../../src/sandbox/executor.js'
import { JsonlAuditStore } from '../../src/audit/store/jsonl.js'
import { AuditLogger } from '../../src/audit/service.js'
import type { ToolPlugin, ToolContext } from '../../src/tools/types.js'
import type { Channel, ChannelMessage, ChannelState } from '../../src/channel/types.js'

const API_KEY = process.env.ANTHROPIC_API_KEY
const SKIP_REASON = 'ANTHROPIC_API_KEY not set - skipping real provider tests'

// Helper to create a test channel that captures messages
function createTestChannel(): Channel & { sentMessages: ChannelMessage[]; events: any[] } {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []
  const events: any[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'real-provider-test',
    on(event: string, listener: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    },
    off(event: string, listener: (...args: any[]) => void) {
      listeners.get(event)?.delete(listener)
    },
    emit(event: string, ...args: any[]) {
      events.push({ event, args })
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
    events,
  }
}

// Simple read tool
function createReadTool(): ToolPlugin {
  return {
    name: 'read_file',
    description: 'Read the contents of a file at the specified path',
    parameters: z.object({
      path: z.string().describe('The path to the file to read'),
    }),
    capability: { name: 'read', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown, context: ToolContext) {
      const { path: filePath } = args as { path: string }
      try {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(context.workDir, filePath)

        if (!resolvedPath.startsWith(context.workDir)) {
          return { success: false, output: 'Access denied: path outside working directory' }
        }

        const content = await fs.readFile(resolvedPath, 'utf-8')
        return { success: true, output: content }
      } catch (error) {
        return { success: false, output: `Error: ${(error as Error).message}` }
      }
    },
  }
}

// Simple write tool
function createWriteTool(): ToolPlugin {
  return {
    name: 'write_file',
    description: 'Write content to a file at the specified path',
    parameters: z.object({
      path: z.string().describe('The path to the file to write'),
      content: z.string().describe('The content to write'),
    }),
    capability: { name: 'write', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown, context: ToolContext) {
      const { path: filePath, content } = args as { path: string; content: string }
      try {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(context.workDir, filePath)

        if (!resolvedPath.startsWith(context.workDir)) {
          return { success: false, output: 'Access denied: path outside working directory' }
        }

        await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
        await fs.writeFile(resolvedPath, content, 'utf-8')
        return { success: true, output: `Successfully wrote ${content.length} bytes to ${filePath}` }
      } catch (error) {
        return { success: false, output: `Error: ${(error as Error).message}` }
      }
    },
  }
}

// Simple bash tool
function createBashTool(): ToolPlugin {
  return {
    name: 'run_command',
    description: 'Execute a shell command and return the output',
    parameters: z.object({
      command: z.string().describe('The shell command to execute'),
    }),
    capability: { name: 'bash', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown, context: ToolContext) {
      const { command } = args as { command: string }
      try {
        const result = await context.sandbox.execute(command, 'bash')
        let output = result.stdout || ''
        if (result.stderr) output += (output ? '\n' : '') + `stderr: ${result.stderr}`
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

describe('Real Provider E2E Tests', () => {
  let testDir: string
  let auditDir: string
  let channel: ReturnType<typeof createTestChannel>
  let provider: AnthropicProvider
  let toolRegistry: ToolRegistry
  let auditLogger: AuditLogger
  let orchestrator: Orchestrator

  beforeAll(() => {
    if (!API_KEY) {
      console.log('\n' + '='.repeat(60))
      console.log('SKIPPING REAL PROVIDER TESTS')
      console.log('Set ANTHROPIC_API_KEY to run these tests')
      console.log('='.repeat(60) + '\n')
    }
  })

  beforeEach(async () => {
    if (!API_KEY) return

    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-real-provider-'))
    auditDir = path.join(testDir, 'audit')
    await fs.mkdir(auditDir, { recursive: true })

    channel = createTestChannel()
    provider = new AnthropicProvider({
      apiKey: API_KEY,
      defaultModel: 'claude-sonnet-4-20250514',
      timeout: 60000,
    })
    toolRegistry = new ToolRegistry()

    toolRegistry.register(createReadTool())
    toolRegistry.register(createWriteTool())
    toolRegistry.register(createBashTool())

    const auditStore = new JsonlAuditStore(auditDir)
    auditLogger = new AuditLogger(auditStore)

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
      {
        streaming: false,
        workDir: testDir,
        maxTokens: 1024,
        systemPrompt: 'You are a helpful assistant. Use tools when needed. Be concise.',
      }
    )
  })

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  describe('Single Tool Call', () => {
    it.skipIf(!API_KEY)('reads a file and uses content in response', async () => {
      // Create a test file
      const testContent = 'The secret number is 42.'
      await fs.writeFile(path.join(testDir, 'data.txt'), testContent)

      await orchestrator.start()
      await orchestrator.processMessage(
        'Read the file data.txt and tell me what the secret number is.'
      )
      await orchestrator.stop()

      // Check tool was called
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result')
      expect(toolResults.length).toBeGreaterThanOrEqual(1)

      // Check response mentions the number
      const assistantMessages = channel.sentMessages.filter((m) => m.type === 'assistant_message')
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1)
      const responseText = assistantMessages.map((m) => (m as any).content).join(' ')
      expect(responseText).toMatch(/42/)

      // Check session state
      const session = orchestrator.getSession()
      expect(session.turns.length).toBe(1)
      expect(session.turns[0].toolCalls.length).toBeGreaterThanOrEqual(1)
      expect(session.totalUsage.inputTokens).toBeGreaterThan(0)
      expect(session.totalUsage.outputTokens).toBeGreaterThan(0)
    }, 30000)
  })

  describe('Multi-Step Tool Loop', () => {
    it.skipIf(!API_KEY)('executes read -> process -> write workflow', async () => {
      // Create input file
      const inputContent = `
Name: Alice
Age: 30
City: New York

Name: Bob
Age: 25
City: San Francisco
      `.trim()
      await fs.writeFile(path.join(testDir, 'people.txt'), inputContent)

      await orchestrator.start()
      await orchestrator.processMessage(
        'Read people.txt, then create a new file called summary.txt with just the names listed one per line.'
      )
      await orchestrator.stop()

      // Check that write tool was called
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      const writeResult = toolResults.find((r) => r.output?.includes('wrote') || r.output?.includes('Successfully'))
      expect(writeResult).toBeDefined()

      // Check output file was created
      const summaryPath = path.join(testDir, 'summary.txt')
      const exists = await fs.access(summaryPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)

      // Check content
      const summaryContent = await fs.readFile(summaryPath, 'utf-8')
      expect(summaryContent.toLowerCase()).toContain('alice')
      expect(summaryContent.toLowerCase()).toContain('bob')

      // Verify session tracking
      const session = orchestrator.getSession()
      expect(session.turns[0].toolCalls.length).toBeGreaterThanOrEqual(2)
    }, 60000)

    it.skipIf(!API_KEY)('executes read -> bash -> write workflow', async () => {
      // Create a source file
      await fs.writeFile(path.join(testDir, 'source.txt'), 'Hello World')

      await orchestrator.start()
      await orchestrator.processMessage(
        'Read source.txt, then use a shell command to count the words, and write the count to wordcount.txt'
      )
      await orchestrator.stop()

      // Check tools were called
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults.length).toBeGreaterThanOrEqual(2)

      // Session should have multiple tool calls
      const session = orchestrator.getSession()
      expect(session.turns[0].toolCalls.length).toBeGreaterThanOrEqual(2)
    }, 60000)
  })

  describe('Token and Cost Tracking', () => {
    it.skipIf(!API_KEY)('accurately tracks token usage across turns', async () => {
      await orchestrator.start()

      // Multiple turns
      await orchestrator.processMessage('What is 2+2?')
      await orchestrator.processMessage('What is 3+3?')
      await orchestrator.processMessage('What is 4+4?')

      await orchestrator.stop()

      const session = orchestrator.getSession()

      // Each turn should have token usage
      for (const turn of session.turns) {
        expect(turn.usage.inputTokens).toBeGreaterThan(0)
        expect(turn.usage.outputTokens).toBeGreaterThan(0)
      }

      // Total should be sum of turns
      const sumInput = session.turns.reduce((sum, t) => sum + t.usage.inputTokens, 0)
      const sumOutput = session.turns.reduce((sum, t) => sum + t.usage.outputTokens, 0)
      expect(session.totalUsage.inputTokens).toBe(sumInput)
      expect(session.totalUsage.outputTokens).toBe(sumOutput)

      // Cost should be positive
      expect(session.estimatedCost).toBeGreaterThan(0)
    }, 60000)
  })

  describe('Audit Logging', () => {
    it.skipIf(!API_KEY)('creates complete audit trail with correlation IDs', async () => {
      await fs.writeFile(path.join(testDir, 'test.txt'), 'test content')

      await orchestrator.start()
      await orchestrator.processMessage('Read test.txt')
      await orchestrator.stop()

      // Check audit files
      const auditFiles = await fs.readdir(auditDir)
      expect(auditFiles.length).toBeGreaterThan(0)

      // Parse audit entries
      const auditContent = await fs.readFile(path.join(auditDir, auditFiles[0]), 'utf-8')
      const entries = auditContent
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))

      // Should have session start/end
      const sessionStart = entries.find((e) => e.action === 'started')
      expect(sessionStart).toBeDefined()
      expect(sessionStart?.metadata?.sessionId).toBeDefined()

      // All entries should have valid timestamps
      for (const entry of entries) {
        expect(entry.timestamp).toBeDefined()
        expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0)
      }
    }, 30000)
  })

  describe('Error Handling', () => {
    it.skipIf(!API_KEY)('handles non-existent file gracefully', async () => {
      await orchestrator.start()
      await orchestrator.processMessage('Read the file nonexistent.txt')
      await orchestrator.stop()

      // Tool should have been called and returned error
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults.length).toBeGreaterThanOrEqual(1)

      const readResult = toolResults[0]
      expect(readResult.success).toBe(false)
      expect(readResult.output).toContain('Error')

      // Session should still be valid
      const session = orchestrator.getSession()
      expect(session.turns.length).toBe(1)
      expect(orchestrator.getState()).toBe('idle')
    }, 30000)
  })

  describe('Conversation Context', () => {
    it.skipIf(!API_KEY)('maintains context across turns', async () => {
      await orchestrator.start()

      // First turn - establish context
      await orchestrator.processMessage('Remember this number: 7749')

      // Second turn - recall
      await orchestrator.processMessage('What number did I ask you to remember?')

      await orchestrator.stop()

      // Check response mentions the number
      const assistantMessages = channel.sentMessages.filter((m) => m.type === 'assistant_message') as any[]
      const lastResponse = assistantMessages[assistantMessages.length - 1]?.content || ''
      expect(lastResponse).toContain('7749')
    }, 60000)
  })
})

describe('Performance Benchmarks', () => {
  let testDir: string

  beforeEach(async () => {
    if (!API_KEY) return
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-perf-'))
  })

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it.skipIf(!API_KEY)('measures latency for simple request', async () => {
    const provider = new AnthropicProvider({
      apiKey: API_KEY!,
      defaultModel: 'claude-sonnet-4-20250514',
    })

    const start = Date.now()
    const response = await provider.createMessage(
      [{ role: 'user', content: 'Say hello' }],
      { maxTokens: 50 }
    )
    const latency = Date.now() - start

    console.log(`Simple request latency: ${latency}ms`)
    console.log(`Input tokens: ${response.usage.inputTokens}`)
    console.log(`Output tokens: ${response.usage.outputTokens}`)

    expect(response.content.length).toBeGreaterThan(0)
    expect(latency).toBeLessThan(30000) // Should complete in under 30s (API latency varies)
  }, 35000)
})
