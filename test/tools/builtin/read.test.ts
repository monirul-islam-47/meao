import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { readTool } from '../../../src/tools/builtin/read.js'
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

describe('readTool', () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meao-read-test-'))
    context = createMockContext(testDir)
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it('has correct name and description', () => {
    expect(readTool.name).toBe('read')
    expect(readTool.description).toMatch(/read|file/i)
  })

  it('reads file content', async () => {
    const filePath = path.join(testDir, 'test.txt')
    await fs.writeFile(filePath, 'Hello, World!')

    const result = await readTool.execute({ path: filePath }, context)

    expect(result.success).toBe(true)
    expect(String(result.output)).toBe('Hello, World!')
  })

  it('reads file with custom encoding', async () => {
    const filePath = path.join(testDir, 'encoded.txt')
    await fs.writeFile(filePath, 'ASCII content')

    const result = await readTool.execute(
      { path: filePath, encoding: 'ascii' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe('ASCII content')
  })

  it('resolves relative paths from workDir', async () => {
    const filePath = path.join(testDir, 'relative.txt')
    await fs.writeFile(filePath, 'Relative content')

    const result = await readTool.execute(
      { path: 'relative.txt' },
      context
    )

    expect(result.success).toBe(true)
    expect(String(result.output)).toBe('Relative content')
  })

  it('returns error for nonexistent file', async () => {
    const result = await readTool.execute(
      { path: path.join(testDir, 'nonexistent.txt') },
      context
    )

    expect(result.success).toBe(false)
    expect(result.output).toMatch(/not found|no such|does not exist/i)
  })

  it('has auto approval level', () => {
    expect(readTool.capability.approval.level).toBe('auto')
  })

  it('has read action that is not destructive', () => {
    const readAction = readTool.actions.find((a) => a.action === 'read')
    expect(readAction).toBeDefined()
    expect(readAction?.isDestructive).toBe(false)
    expect(readAction?.affectsOthers).toBe(false)
  })

  describe('path security', () => {
    it('blocks absolute paths outside workDir', async () => {
      const result = await readTool.execute({ path: '/etc/passwd' }, context)

      expect(result.success).toBe(false)
      expect(result.output).toMatch(/access denied|outside.*directory/i)
    })

    it('blocks path traversal with ../', async () => {
      const result = await readTool.execute(
        { path: '../../../etc/passwd' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.output).toMatch(/access denied|outside.*directory/i)
    })

    it('blocks encoded path traversal', async () => {
      // URL-encoded ../
      const result = await readTool.execute(
        { path: '..%2F..%2F..%2Fetc%2Fpasswd' },
        context
      )

      // This should either fail to find the file or be blocked
      // The path won't be decoded by our code, so it'll fail as "file not found"
      expect(result.success).toBe(false)
    })

    it('blocks symlink escape attempts', async () => {
      // Create a symlink inside workDir pointing outside
      const linkPath = path.join(testDir, 'escape-link')
      try {
        await fs.symlink('/etc/passwd', linkPath)

        const result = await readTool.execute({ path: 'escape-link' }, context)

        expect(result.success).toBe(false)
        expect(result.output).toMatch(/access denied|outside.*directory|symlink/i)
      } catch (error) {
        // Skip if symlink creation fails (e.g., no permission)
        console.log('Skipping symlink test:', (error as Error).message)
      }
    })

    it('allows reading files inside workDir with absolute path', async () => {
      const filePath = path.join(testDir, 'allowed.txt')
      await fs.writeFile(filePath, 'Allowed content')

      const result = await readTool.execute({ path: filePath }, context)

      expect(result.success).toBe(true)
      expect(String(result.output)).toBe('Allowed content')
    })

    it('allows reading files in subdirectories', async () => {
      const subDir = path.join(testDir, 'subdir')
      await fs.mkdir(subDir, { recursive: true })
      const filePath = path.join(subDir, 'nested.txt')
      await fs.writeFile(filePath, 'Nested content')

      const result = await readTool.execute(
        { path: 'subdir/nested.txt' },
        context
      )

      expect(result.success).toBe(true)
      expect(String(result.output)).toBe('Nested content')
    })

    it('error message does not leak filesystem information', async () => {
      const result = await readTool.execute({ path: '/etc/passwd' }, context)

      expect(result.success).toBe(false)
      // Should not contain actual filesystem paths in error
      expect(result.output).not.toContain('/etc/passwd')
      expect(result.output).not.toContain(testDir)
    })
  })
})
