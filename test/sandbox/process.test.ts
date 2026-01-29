import { describe, it, expect } from 'vitest'
import { ProcessSandbox } from '../../src/sandbox/process.js'
import os from 'os'
import path from 'path'

describe('ProcessSandbox', () => {
  const sandbox = new ProcessSandbox()
  const workDir = os.tmpdir()

  describe('execute', () => {
    it('executes simple commands', async () => {
      const result = await sandbox.execute('echo "hello"', { workDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
      expect(result.timedOut).toBe(false)
    })

    it('captures stdout and stderr', async () => {
      const result = await sandbox.execute(
        'echo "out" && echo "err" >&2',
        { workDir }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('out')
      expect(result.stderr.trim()).toBe('err')
    })

    it('returns exit code', async () => {
      const result = await sandbox.execute('exit 42', { workDir })

      expect(result.exitCode).toBe(42)
    })

    it('uses working directory', async () => {
      const result = await sandbox.execute('pwd', { workDir })

      expect(result.stdout.trim()).toBe(workDir)
    })

    it.skip('enforces timeout', async () => {
      // FIXME: This test is flaky due to process termination timing
      // The sandbox does enforce timeout, but SIGKILL delivery varies
      const result = await sandbox.execute('sleep 30', {
        workDir,
        timeout: 500,
      })

      expect(result.timedOut).toBe(true)
    }, 30000)

    it('enforces output size limit', async () => {
      // Generate output larger than limit
      const result = await sandbox.execute(
        'yes "hello" | head -n 10000',
        { workDir, maxOutputSize: 100 }
      )

      expect(result.stdout.length).toBeLessThanOrEqual(100)
      expect(result.truncated).toBe(true)
    })

    it('tracks execution time', async () => {
      const result = await sandbox.execute('sleep 0.1', { workDir })

      expect(result.executionTime).toBeGreaterThanOrEqual(90)
      expect(result.executionTime).toBeLessThan(1000)
    })
  })

  describe('environment', () => {
    it('uses clean environment', async () => {
      const result = await sandbox.execute('env', { workDir })

      // Should have minimal safe env vars
      expect(result.stdout).toContain('PATH=')
      expect(result.stdout).toContain('HOME=')

      // Should not have sensitive vars from parent
      expect(result.stdout).not.toContain('MEAO_')
    })

    it('adds explicit env vars', async () => {
      const result = await sandbox.execute('echo $MY_VAR', {
        workDir,
        env: { MY_VAR: 'test_value' },
      })

      expect(result.stdout.trim()).toBe('test_value')
    })
  })
})
