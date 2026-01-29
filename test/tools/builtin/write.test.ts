import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { writeTool } from '../../../src/tools/builtin/write.js'
import type { ToolContext } from '../../../src/tools/types.js'
import { ProcessSandbox } from '../../../src/sandbox/process.js'

const createMockContext = (workDir: string): ToolContext => ({
  sessionId: 'test-session',
  turnId: 'test-turn',
  sandbox: new ProcessSandbox({
    level: 'process',
    networkMode: 'none',
  }),
  workDir,
})

describe('writeTool', () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-write-test-'))
    context = createMockContext(testDir)
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it('has correct name and description', () => {
    expect(writeTool.name).toBe('write')
    expect(writeTool.description).toMatch(/write|file/i)
  })

  it('writes file content', async () => {
    const filePath = path.join(testDir, 'output.txt')

    const result = await writeTool.execute(
      { path: filePath, content: 'Hello, World!' },
      context
    )

    expect(result.success).toBe(true)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('Hello, World!')
  })

  it('creates parent directories by default', async () => {
    const filePath = path.join(testDir, 'nested', 'deep', 'output.txt')

    const result = await writeTool.execute(
      { path: filePath, content: 'Nested content', createDirectories: true },
      context
    )

    if (!result.success) {
      console.error('Write tool failed:', result.output)
    }
    expect(result.success).toBe(true)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('Nested content')
  })

  it('can disable directory creation', async () => {
    const filePath = path.join(testDir, 'nonexistent', 'output.txt')

    const result = await writeTool.execute(
      { path: filePath, content: 'Content', createDirectories: false },
      context
    )

    expect(result.success).toBe(false)
    expect(result.output).toMatch(/error/i)
  })

  it('resolves relative paths from workDir', async () => {
    const result = await writeTool.execute(
      { path: 'relative.txt', content: 'Relative content' },
      context
    )

    expect(result.success).toBe(true)
    const content = await fs.readFile(path.join(testDir, 'relative.txt'), 'utf-8')
    expect(content).toBe('Relative content')
  })

  it('has ask approval level', () => {
    expect(writeTool.capability.approval.level).toBe('ask')
  })

  it('has write action that is destructive', () => {
    const writeAction = writeTool.actions.find((a) => a.action === 'write')
    expect(writeAction).toBeDefined()
    expect(writeAction?.isDestructive).toBe(true)
    expect(writeAction?.affectsOthers).toBe(false)
  })

  it('reports bytes written on success', async () => {
    const content = 'Test content 123'
    const result = await writeTool.execute(
      { path: path.join(testDir, 'test.txt'), content },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain(String(content.length))
    expect(result.output).toContain('bytes')
  })
})
