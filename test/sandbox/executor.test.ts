import { describe, it, expect } from 'vitest'
import { SandboxExecutor } from '../../src/sandbox/executor.js'
import { DEFAULT_SANDBOX_LEVELS } from '../../src/sandbox/types.js'
import os from 'os'

describe('SandboxExecutor', () => {
  const workDir = os.tmpdir()
  const executor = new SandboxExecutor({ workDir })

  describe('getSandboxLevel', () => {
    it('returns default levels for known tools', () => {
      expect(executor.getSandboxLevel('read')).toBe('process')
      expect(executor.getSandboxLevel('write')).toBe('process')
      expect(executor.getSandboxLevel('bash')).toBe('container')
      expect(executor.getSandboxLevel('python')).toBe('container')
    })

    it('returns process for unknown tools', () => {
      expect(executor.getSandboxLevel('unknown_tool')).toBe('process')
    })

    it('respects custom sandbox levels', () => {
      const customExecutor = new SandboxExecutor({
        workDir,
        sandboxLevels: { custom_tool: 'container' },
      })

      expect(customExecutor.getSandboxLevel('custom_tool')).toBe('container')
    })
  })

  describe('execute', () => {
    it('executes commands for process-level tools', async () => {
      const result = await executor.execute('echo "test"', 'read')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('test')
    })

    it('falls back to process for container if Docker unavailable', async () => {
      // This test will work whether Docker is available or not
      const result = await executor.execute('echo "test"', 'bash')

      // Either container or process sandbox should succeed
      expect(result.stdout.trim()).toBe('test')
    })
  })

  describe('isContainerAvailable', () => {
    it('returns a boolean', () => {
      const result = executor.isContainerAvailable()
      expect(typeof result).toBe('boolean')
    })
  })
})

describe('DEFAULT_SANDBOX_LEVELS', () => {
  it('defines container level for bash', () => {
    expect(DEFAULT_SANDBOX_LEVELS.bash).toBe('container')
  })

  it('defines container level for python', () => {
    expect(DEFAULT_SANDBOX_LEVELS.python).toBe('container')
  })

  it('defines process level for read/write', () => {
    expect(DEFAULT_SANDBOX_LEVELS.read).toBe('process')
    expect(DEFAULT_SANDBOX_LEVELS.write).toBe('process')
  })

  it('defines process level for web_fetch', () => {
    expect(DEFAULT_SANDBOX_LEVELS.web_fetch).toBe('process')
  })
})
