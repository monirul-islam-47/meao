import { describe, it, expect, beforeEach, vi } from 'vitest'
import { z } from 'zod'
import { ToolExecutor } from '../../src/tools/executor.js'
import {
  createAutoApproveManager,
  createDenyAllManager,
} from '../../src/tools/approvals.js'
import type { ToolPlugin, ToolContext } from '../../src/tools/types.js'
import { ApprovalManager } from '../../src/tools/approvals.js'

const createMockContext = (): ToolContext => ({
  sessionId: 'test-session',
  requestId: 'test-request',
  approvals: [],
  audit: {
    log: vi.fn().mockResolvedValue(undefined),
  } as any,
  sandbox: {} as any,
  workDir: '/tmp',
})

const createTestTool = (
  name: string,
  executeResult: { success: boolean; output: string },
  options: { approvalLevel?: 'auto' | 'ask' | 'always' } = {}
): ToolPlugin => ({
  name,
  description: `Test tool ${name}`,
  parameters: z.object({
    input: z.string().optional(),
    command: z.string().optional(),
  }),
  capability: {
    name,
    approval: { level: options.approvalLevel ?? 'auto' },
  },
  actions: [],
  execute: vi.fn().mockResolvedValue(executeResult),
})

describe('ToolExecutor', () => {
  let executor: ToolExecutor
  let context: ToolContext

  beforeEach(() => {
    executor = new ToolExecutor(createAutoApproveManager())
    context = createMockContext()
  })

  describe('execute', () => {
    it('executes tool successfully', async () => {
      const tool = createTestTool('test', { success: true, output: 'result' })

      const result = await executor.execute(tool, { input: 'hello' }, context)

      expect(result.success).toBe(true)
      expect(result.output).toBe('result')
      expect(tool.execute).toHaveBeenCalledWith(
        { input: 'hello' },
        context
      )
    })

    it('validates parameters', async () => {
      const tool: ToolPlugin = {
        name: 'strict',
        description: 'Tool with strict params',
        parameters: z.object({
          required: z.string(),
          count: z.number().min(1),
        }),
        capability: {
          name: 'strict',
          approval: { level: 'auto' },
        },
        actions: [],
        execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
      }

      // Missing required field
      const result1 = await executor.execute(tool, {}, context)
      expect(result1.success).toBe(false)
      expect(result1.output).toMatch(/error/i)

      // Invalid type
      const result2 = await executor.execute(tool, { required: 123, count: 1 }, context)
      expect(result2.success).toBe(false)
    })

    it('handles tool execution errors', async () => {
      const tool: ToolPlugin = {
        name: 'failing',
        description: 'Tool that throws',
        parameters: z.object({}),
        capability: {
          name: 'failing',
          approval: { level: 'auto' },
        },
        actions: [],
        execute: vi.fn().mockRejectedValue(new Error('Tool crashed')),
      }

      const result = await executor.execute(tool, {}, context)

      expect(result.success).toBe(false)
      expect(result.output).toMatch(/tool crashed/i)
    })

    it('includes execution time in result', async () => {
      const tool = createTestTool('test', { success: true, output: 'result' })

      const result = await executor.execute(tool, {}, context)

      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })

    it('includes label in result', async () => {
      const tool = createTestTool('test', { success: true, output: 'result' })

      const result = await executor.execute(tool, {}, context)

      expect(result.label).toBeDefined()
      expect(result.label?.trustLevel).toBeDefined()
      expect(result.label?.dataClass).toBeDefined()
    })
  })

  describe('approval flow', () => {
    it('auto-approves tools with auto level', async () => {
      const tool = createTestTool('auto_tool', { success: true, output: 'ok' }, { approvalLevel: 'auto' })

      const result = await executor.execute(tool, {}, context)

      expect(result.success).toBe(true)
    })

    it('asks for approval when level is ask', async () => {
      const callback = vi.fn().mockResolvedValue(true)
      const manager = new ApprovalManager(callback)
      const askExecutor = new ToolExecutor(manager)

      const tool = createTestTool('ask_tool', { success: true, output: 'approved' }, { approvalLevel: 'ask' })

      // Must provide a valid target (command/path/url) for approval
      const result = await askExecutor.execute(tool, { command: 'ls -la' }, context)

      expect(callback).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('respects user denial in interactive mode', async () => {
      const callback = vi.fn().mockResolvedValue(false)
      const manager = new ApprovalManager(callback)
      const denyExecutor = new ToolExecutor(manager)

      const tool = createTestTool('denied_tool', { success: true, output: 'should not run' }, { approvalLevel: 'ask' })

      // Must provide a valid target (command/path/url) for approval
      const result = await denyExecutor.execute(tool, { command: 'rm -rf /' }, context)

      expect(result.success).toBe(false)
      expect(result.output).toMatch(/denied/i)
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('reuses existing approvals', async () => {
      const callback = vi.fn().mockResolvedValue(true)
      const manager = new ApprovalManager(callback)
      const askExecutor = new ToolExecutor(manager)

      const tool = createTestTool('reuse_tool', { success: true, output: 'ok' }, { approvalLevel: 'ask' })

      // First call - should ask (must provide same command for approval reuse)
      await askExecutor.execute(tool, { command: 'echo hello' }, context)
      const firstCallCount = callback.mock.calls.length

      // Second call with same command - should reuse approval
      await askExecutor.execute(tool, { command: 'echo hello' }, context)

      // Callback should only be called once (approval was cached)
      expect(callback.mock.calls.length).toBe(firstCallCount)
    })
  })

  describe('output processing', () => {
    it('redacts secrets from output', async () => {
      // Use a GitHub PAT format: ghp_ + 36 alphanumeric chars = 40 total
      const fakeKey = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
      const secretOutput = `Token: ${fakeKey}`
      const tool = createTestTool('secret_tool', { success: true, output: secretOutput })

      const result = await executor.execute(tool, {}, context)

      // Secret should be redacted
      expect(result.output).not.toContain(fakeKey)
      expect(result.output).toMatch(/REDACTED/i)
    })

    it('truncates long output', async () => {
      const longOutput = 'x'.repeat(100000)
      const tool = createTestTool('verbose_tool', { success: true, output: longOutput })

      const result = await executor.execute(tool, {}, context)

      expect(result.output.length).toBeLessThan(longOutput.length)
      expect(result.truncated).toBe(true)
      expect(result.output).toContain('TRUNCATED')
    })
  })

  describe('audit logging', () => {
    it('logs successful execution', async () => {
      const tool = createTestTool('test', { success: true, output: 'result' })

      await executor.execute(tool, {}, context)

      expect(context.audit.log).toHaveBeenCalled()
      const logCall = (context.audit.log as any).mock.calls.find(
        (call: any[]) => call[0].action === 'executed'
      )
      expect(logCall).toBeDefined()
      expect(logCall[0].metadata.toolName).toBe('test')
      expect(logCall[0].metadata.success).toBe(true)
    })

    it('logs errors', async () => {
      const tool: ToolPlugin = {
        name: 'error_tool',
        description: 'Tool that errors',
        parameters: z.object({}),
        capability: {
          name: 'error_tool',
          approval: { level: 'auto' },
        },
        actions: [],
        execute: vi.fn().mockRejectedValue(new Error('Test error')),
      }

      await executor.execute(tool, {}, context)

      expect(context.audit.log).toHaveBeenCalled()
      const logCall = (context.audit.log as any).mock.calls.find(
        (call: any[]) => call[0].action === 'error'
      )
      expect(logCall).toBeDefined()
    })
  })
})
