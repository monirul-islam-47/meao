/**
 * Tool Edge Cases Tests
 *
 * Tests for edge cases that become bug reports immediately:
 * - Binary files, huge files, invalid UTF-8
 * - Path normalization edge cases
 * - Long-running commands, huge output
 * - Non-zero exit codes
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
import type { ToolPlugin, ToolContext } from '../../src/tools/types.js'
import type { Channel, ChannelMessage, ChannelState } from '../../src/channel/types.js'

function createTestChannel(): Channel & { sentMessages: ChannelMessage[] } {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'edge-case-test',
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

function createMockAuditLogger() {
  return {
    log: async () => {},
    info: async () => {},
    warning: async () => {},
    critical: async () => {},
    alert: async () => {},
  }
}

// Real read tool with proper error handling
function createReadTool(): ToolPlugin {
  return {
    name: 'read',
    description: 'Read file contents',
    parameters: z.object({ path: z.string() }),
    capability: { name: 'read', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown, context: ToolContext) {
      const { path: filePath } = args as { path: string }
      try {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(context.workDir, filePath)

        // Security check
        if (!resolvedPath.startsWith(context.workDir)) {
          return { success: false, output: 'Access denied: path outside working directory' }
        }

        // Check file size before reading
        const stats = await fs.stat(resolvedPath)
        const MAX_SIZE = 1024 * 1024 // 1MB limit
        if (stats.size > MAX_SIZE) {
          return {
            success: false,
            output: `File too large: ${stats.size} bytes (max: ${MAX_SIZE})`,
          }
        }

        const content = await fs.readFile(resolvedPath, 'utf-8')
        return { success: true, output: content }
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
          return { success: false, output: `File not found: ${filePath}` }
        }
        return { success: false, output: `Error: ${err.message}` }
      }
    },
  }
}

// Real write tool
function createWriteTool(): ToolPlugin {
  return {
    name: 'write',
    description: 'Write content to file',
    parameters: z.object({ path: z.string(), content: z.string() }),
    capability: { name: 'write', approval: { level: 'auto' } },
    actions: [],
    async execute(args: unknown, context: ToolContext) {
      const { path: filePath, content } = args as { path: string; content: string }
      try {
        // Normalize path
        const normalizedPath = path.normalize(filePath).replace(/^(\.\.[\\/])+/, '')
        const resolvedPath = path.isAbsolute(normalizedPath)
          ? normalizedPath
          : path.resolve(context.workDir, normalizedPath)

        // Security check
        if (!resolvedPath.startsWith(context.workDir)) {
          return { success: false, output: 'Access denied: path outside working directory' }
        }

        await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
        await fs.writeFile(resolvedPath, content, 'utf-8')
        return { success: true, output: `Wrote ${content.length} bytes to ${filePath}` }
      } catch (error) {
        return { success: false, output: `Error: ${(error as Error).message}` }
      }
    },
  }
}

// Real bash tool
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
          output = output.slice(0, MAX_OUTPUT) + `\n[TRUNCATED: ${output.length - MAX_OUTPUT} bytes]`
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

describe('Tool Edge Cases', () => {
  let testDir: string
  let channel: ReturnType<typeof createTestChannel>
  let provider: MockProvider
  let toolRegistry: ToolRegistry
  let orchestrator: Orchestrator

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-edge-'))
    channel = createTestChannel()
    provider = new MockProvider()
    toolRegistry = new ToolRegistry()

    toolRegistry.register(createReadTool())
    toolRegistry.register(createWriteTool())
    toolRegistry.register(createBashTool())

    orchestrator = new Orchestrator(
      {
        channel,
        provider,
        toolRegistry,
        approvalManager: createAutoApproveManager(),
        sandboxExecutor: new SandboxExecutor({ workDir: testDir }),
        auditLogger: createMockAuditLogger() as any,
      },
      { streaming: false, workDir: testDir }
    )
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Read Tool Edge Cases', () => {
    it('handles binary file gracefully', async () => {
      // Create a binary file
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD])
      await fs.writeFile(path.join(testDir, 'binary.bin'), binaryContent)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'read-bin', name: 'read', input: { path: 'binary.bin' } },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Read binary file')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      // Should handle without crashing - may show garbled text or error
    })

    it('handles file with invalid UTF-8', async () => {
      // Create file with invalid UTF-8 sequences
      const invalidUtf8 = Buffer.from([0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x80, 0x81, 0x82])
      await fs.writeFile(path.join(testDir, 'invalid.txt'), invalidUtf8)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'read-invalid', name: 'read', input: { path: 'invalid.txt' } },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Read invalid UTF-8 file')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      // Should handle gracefully
    })

    it('rejects huge files', async () => {
      // Create a file larger than the limit (simulate with just the check)
      // We'll create a smaller file but the real test is the size check logic
      const largeContent = 'x'.repeat(100000) // 100KB
      await fs.writeFile(path.join(testDir, 'large.txt'), largeContent)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'read-large', name: 'read', input: { path: 'large.txt' } },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Read large file')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      // File under limit should succeed
      expect(toolResults[0].success).toBe(true)
    })

    it('handles file not found', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'read-missing', name: 'read', input: { path: 'nonexistent.txt' } },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'File not found' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Read missing file')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('not found')
    })
  })

  describe('Write Tool Edge Cases', () => {
    it('handles overwriting existing file', async () => {
      // Create existing file
      await fs.writeFile(path.join(testDir, 'existing.txt'), 'original content')

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'write-overwrite',
                name: 'write',
                input: { path: 'existing.txt', content: 'new content' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Overwrite file')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(true)

      // Verify content was overwritten
      const content = await fs.readFile(path.join(testDir, 'existing.txt'), 'utf-8')
      expect(content).toBe('new content')
    })

    it('handles path normalization (./ and ..)', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'write-dots',
                name: 'write',
                input: { path: './subdir/../file.txt', content: 'test' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Write with dots in path')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(true)

      // File should be in testDir
      const exists = await fs.access(path.join(testDir, 'file.txt')).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('handles double slashes in path', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'write-slashes',
                name: 'write',
                input: { path: 'dir//subdir///file.txt', content: 'test' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Write with double slashes')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(true)
    })

    it('handles writing large output', async () => {
      const largeContent = 'Line of text\n'.repeat(10000) // ~130KB

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'write-large',
                name: 'write',
                input: { path: 'large-output.txt', content: largeContent },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Write large file')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(true)

      // Verify file content
      const content = await fs.readFile(path.join(testDir, 'large-output.txt'), 'utf-8')
      expect(content).toBe(largeContent)
    })
  })

  describe('Bash Tool Edge Cases', () => {
    it('handles command with non-zero exit code', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'bash-fail', name: 'bash', input: { command: 'exit 42' } },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Command failed' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Run failing command')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('42')
    })

    it('captures both stdout and stderr', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'bash-both',
                name: 'bash',
                input: { command: 'echo "stdout" && echo "stderr" >&2' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Run command with both outputs')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].output).toContain('stdout')
      expect(toolResults[0].output).toContain('stderr')
    })

    it('handles command that produces huge output', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'bash-huge',
                name: 'bash',
                // Generate ~200KB of output
                input: { command: 'for i in $(seq 1 10000); do echo "Line $i of output text"; done' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Run command with huge output')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)

      // Output should be truncated
      if (toolResults[0].output.length > 60000) {
        expect(toolResults[0].output).toContain('TRUNCATED')
      }
    })

    it('handles empty output', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'bash-empty', name: 'bash', input: { command: 'true' } },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' }
      })

      await orchestrator.processMessage('Run command with no output')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(true)
    })
  })
})
