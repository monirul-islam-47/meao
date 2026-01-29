/**
 * E2E Smoke Tests
 *
 * These tests exercise the full stack with realistic scenarios:
 * CLI → Provider → Tool Loop → Sandbox → Redaction/Labels → Audit → Response
 *
 * Uses MockProvider but tests real tool execution and file I/O.
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
import { secretDetector } from '../../src/security/secrets/index.js'
import type { ToolPlugin, ToolContext } from '../../src/tools/types.js'
import type { Channel, ChannelMessage, ChannelState } from '../../src/channel/types.js'

function createTestChannel(): Channel & { sentMessages: ChannelMessage[] } {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const sentMessages: ChannelMessage[] = []

  return {
    state: 'connected' as ChannelState,
    sessionId: 'e2e-test-session',
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

// Real file tools for E2E testing
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

        // Security: block path traversal
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
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(context.workDir, filePath)

        // Security: block path traversal
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

describe('E2E Smoke Tests', () => {
  let testDir: string
  let auditDir: string
  let channel: ReturnType<typeof createTestChannel>
  let provider: MockProvider
  let toolRegistry: ToolRegistry
  let auditLogger: AuditLogger
  let orchestrator: Orchestrator

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-e2e-'))
    auditDir = path.join(testDir, 'audit')
    await fs.mkdir(auditDir, { recursive: true })

    channel = createTestChannel()
    provider = new MockProvider()
    toolRegistry = new ToolRegistry()

    // Register real tools
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
        // Use process sandbox for bash tool in tests (container sandbox has permission issues with temp dirs)
        sandboxExecutor: new SandboxExecutor({
          workDir: testDir,
          sandboxLevels: { bash: 'process' },
        }),
        auditLogger,
      },
      { streaming: false, workDir: testDir }
    )
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Scenario 1: Read → Summarize → Write', () => {
    it('reads a file with mixed content and secret, summarizes, writes output', async () => {
      // Setup: Create input file with content and a fake secret
      const fakeSecret = 'ghp_TestSecretTokenThatShouldBeRedacted1234'
      const inputContent = `
# Project Notes

This is a test document with important information.
The API key is: ${fakeSecret}

## Summary
- Point 1: Testing is important
- Point 2: Security matters
- Point 3: Automation helps
      `.trim()

      await fs.writeFile(path.join(testDir, 'notes.txt'), inputContent)

      // Setup provider responses
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        switch (callCount) {
          case 1:
            // Read the file
            return {
              content: [
                {
                  type: 'tool_use',
                  id: 'read-1',
                  name: 'read',
                  input: { path: 'notes.txt' },
                },
              ],
              stopReason: 'tool_use',
            }
          case 2:
            // Write summary (model "summarizes" the content)
            return {
              content: [
                {
                  type: 'tool_use',
                  id: 'write-1',
                  name: 'write',
                  input: {
                    path: 'summary.md',
                    content: '# Summary\n\n- Testing is important\n- Security matters\n- Automation helps\n',
                  },
                },
              ],
              stopReason: 'tool_use',
            }
          default:
            return {
              content: [{ type: 'text', text: 'I have read the notes and created a summary.' }],
              stopReason: 'end_turn',
            }
        }
      })

      // Execute
      await orchestrator.start()
      await orchestrator.processMessage('Read notes.txt and write a summary to summary.md')
      await orchestrator.stop()

      // Assert: Output file exists
      const summaryPath = path.join(testDir, 'summary.md')
      const summaryExists = await fs.access(summaryPath).then(() => true).catch(() => false)
      expect(summaryExists).toBe(true)

      const summaryContent = await fs.readFile(summaryPath, 'utf-8')
      expect(summaryContent).toContain('Summary')

      // Assert: Secret not leaked in channel messages
      const allOutputs = channel.sentMessages
        .filter((m) => m.type === 'tool_result' || m.type === 'assistant_message')
        .map((m) => (m as any).output || (m as any).content || '')
        .join('\n')

      // The secret should be redacted in outputs
      expect(allOutputs).not.toContain(fakeSecret)

      // Assert: Audit created
      const auditFiles = await fs.readdir(auditDir)
      expect(auditFiles.length).toBeGreaterThan(0)

      // Assert: Correlation IDs present in audit
      const auditContent = await fs.readFile(path.join(auditDir, auditFiles[0]), 'utf-8')
      const auditEntries = auditContent.trim().split('\n').map((l) => JSON.parse(l))

      const sessionEntry = auditEntries.find((e) => e.action === 'started')
      expect(sessionEntry).toBeDefined()
      expect(sessionEntry?.metadata?.sessionId).toBeDefined()
    })
  })

  describe('Scenario 2: Bash Tool Loop', () => {
    it('executes commands, parses results, runs follow-up', async () => {
      // Setup provider responses for multi-step bash workflow
      // Note: Use relative paths since sandbox workDir is already set to testDir
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        switch (callCount) {
          case 1:
            // First: list files (use pwd to show current directory)
            return {
              content: [
                {
                  type: 'tool_use',
                  id: 'bash-1',
                  name: 'bash',
                  input: { command: 'pwd && ls -la' },
                },
              ],
              stopReason: 'tool_use',
            }
          case 2:
            // Second: create a file (using relative path)
            return {
              content: [
                {
                  type: 'tool_use',
                  id: 'bash-2',
                  name: 'bash',
                  input: { command: 'echo "test content" > created.txt' },
                },
              ],
              stopReason: 'tool_use',
            }
          case 3:
            // Third: verify file (using relative path)
            return {
              content: [
                {
                  type: 'tool_use',
                  id: 'bash-3',
                  name: 'bash',
                  input: { command: 'cat created.txt' },
                },
              ],
              stopReason: 'tool_use',
            }
          default:
            return {
              content: [{ type: 'text', text: 'Created and verified the file.' }],
              stopReason: 'end_turn',
            }
        }
      })

      // Execute
      await orchestrator.processMessage('Create a test file and verify it')

      // Assert: Tool results captured
      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults.length).toBe(3)

      // Assert: All succeeded
      expect(toolResults.every((r) => r.success)).toBe(true)

      // Assert: File was actually created
      const createdPath = path.join(testDir, 'created.txt')
      const fileExists = await fs.access(createdPath).then(() => true).catch(() => false)
      expect(fileExists).toBe(true)

      // Assert: Session state preserved
      const session = orchestrator.getSession()
      expect(session.turns).toHaveLength(1)
      expect(session.turns[0].toolCalls).toHaveLength(3)
    })

    it('handles non-zero exit codes gracefully', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'bash-fail',
                name: 'bash',
                input: { command: 'exit 1' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'The command failed.' }],
          stopReason: 'end_turn',
        }
      })

      await orchestrator.processMessage('Run a failing command')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)

      // Session should still be valid
      expect(orchestrator.getState()).toBe('idle')
    })
  })

  describe('Scenario 3: Secret Redaction Invariant', () => {
    it('never leaks secrets in any output path', async () => {
      // Create file with various secret patterns
      // Note: AWS key uses realistic format without "EXAMPLE" which would be filtered as false positive
      const secrets = {
        github: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
        aws: 'AKIAIOSFODNN7TESTING',
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      }

      const secretFile = `
Credentials file:
GITHUB_TOKEN=${secrets.github}
AWS_ACCESS_KEY=${secrets.aws}
JWT_TOKEN=${secrets.jwt}
      `.trim()

      await fs.writeFile(path.join(testDir, 'secrets.txt'), secretFile)

      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'read-secrets',
                name: 'read',
                input: { path: 'secrets.txt' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'I found some credentials in the file.' }],
          stopReason: 'end_turn',
        }
      })

      await orchestrator.processMessage('Print the secrets file verbatim')

      // Collect all outputs
      const allOutputs: string[] = []
      for (const msg of channel.sentMessages) {
        if ((msg as any).output) allOutputs.push((msg as any).output)
        if ((msg as any).content) allOutputs.push((msg as any).content)
      }
      const combinedOutput = allOutputs.join('\n')

      // Assert: No raw secrets in output
      // Note: The tool output goes through redaction, so secrets should be replaced
      const scanResult = secretDetector.scan(combinedOutput)

      // We expect secrets to either be redacted or not present
      // If they're detected, they should be redacted versions
      for (const secret of Object.values(secrets)) {
        // Raw secret should not appear
        expect(combinedOutput).not.toContain(secret)
      }
    })
  })

  describe('Scenario 4: Path Traversal Prevention', () => {
    it('blocks read attempts outside working directory', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'read-traversal',
                name: 'read',
                input: { path: '../../../etc/passwd' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Access was denied.' }],
          stopReason: 'end_turn',
        }
      })

      await orchestrator.processMessage('Read /etc/passwd')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('denied')
    })

    it('blocks write attempts outside working directory', async () => {
      let callCount = 0
      provider.addGenerator(() => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'write-traversal',
                name: 'write',
                input: { path: '/tmp/malicious.txt', content: 'evil' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: [{ type: 'text', text: 'Write was blocked.' }],
          stopReason: 'end_turn',
        }
      })

      await orchestrator.processMessage('Write to /tmp')

      const toolResults = channel.sentMessages.filter((m) => m.type === 'tool_result') as any[]
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0].success).toBe(false)
      expect(toolResults[0].output).toContain('denied')
    })
  })

  describe('Scenario 5: Cost Tracking Monotonicity', () => {
    it('session total equals sum of turn totals', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      })

      // Multiple turns
      await orchestrator.processMessage('Turn 1')
      await orchestrator.processMessage('Turn 2')
      await orchestrator.processMessage('Turn 3')

      const session = orchestrator.getSession()

      // Calculate sum of turn totals
      let turnInputSum = 0
      let turnOutputSum = 0
      for (const turn of session.turns) {
        turnInputSum += turn.usage.inputTokens
        turnOutputSum += turn.usage.outputTokens

        // No negative values
        expect(turn.usage.inputTokens).toBeGreaterThanOrEqual(0)
        expect(turn.usage.outputTokens).toBeGreaterThanOrEqual(0)
      }

      // Session total = sum of turns
      expect(session.totalUsage.inputTokens).toBe(turnInputSum)
      expect(session.totalUsage.outputTokens).toBe(turnOutputSum)

      // Cost is positive
      expect(session.estimatedCost).toBeGreaterThanOrEqual(0)
    })
  })
})
