import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ContainerSandbox, isDockerAvailable } from '../../src/sandbox/container/index.js'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'

// Skip container tests if Docker is not available
const runContainerTests = isDockerAvailable()

describe.skipIf(!runContainerTests)('ContainerSandbox', () => {
  const sandbox = new ContainerSandbox()
  let workDir: string

  beforeAll(async () => {
    // Create temp directory for tests
    workDir = await mkdtemp(path.join(os.tmpdir(), 'meao-container-test-'))
  })

  afterAll(async () => {
    // Clean up
    if (workDir) {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  describe('execute', () => {
    it('executes simple commands', async () => {
      const result = await sandbox.execute('echo "hello"', {
        workDir,
        image: 'alpine:latest',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    }, 30000) // Allow time for image pull

    it('uses network=none by default', async () => {
      // Attempting to ping should fail immediately with network=none
      const result = await sandbox.execute(
        'ping -c 1 8.8.8.8 2>&1 || echo "network blocked"',
        { workDir, image: 'alpine:latest', timeout: 5000 }
      )

      // Should print network blocked or have network error
      expect(
        result.stdout.includes('network blocked') ||
        result.stdout.includes('Network unreachable') ||
        result.stderr.includes('network') ||
        result.exitCode !== 0
      ).toBe(true)
    }, 15000) // Test timeout

    it('mounts workspace directory', async () => {
      // Verify the workspace mount exists (ls may fail on permissions but mount exists)
      const result = await sandbox.execute('test -d /workspace && echo "mounted"', {
        workDir,
        image: 'alpine:latest',
      })

      // The directory should exist (even if we can't list it due to permissions)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('mounted')
    })

    it('enforces timeout', async () => {
      const result = await sandbox.execute('sleep 30', {
        workDir,
        image: 'alpine:latest',
        timeout: 1000,
      })

      expect(result.timedOut).toBe(true)
    })

    it('enforces output size limit', async () => {
      const result = await sandbox.execute(
        'yes "test" | head -n 10000',
        { workDir, image: 'alpine:latest', maxOutputSize: 100 }
      )

      expect(result.stdout.length).toBeLessThanOrEqual(100)
      expect(result.truncated).toBe(true)
    })
  })

  describe('security hardening', () => {
    it('runs as non-root user', async () => {
      const result = await sandbox.execute('whoami', {
        workDir,
        image: 'alpine:latest',
      })

      expect(result.stdout.trim()).toBe('nobody')
    })

    it('has read-only root filesystem', async () => {
      const result = await sandbox.execute(
        'touch /test.txt 2>&1 || echo "read-only"',
        { workDir, image: 'alpine:latest' }
      )

      expect(
        result.stdout.includes('read-only') ||
        result.stderr.includes('Read-only')
      ).toBe(true)
    })

    it('can write to /tmp', async () => {
      const result = await sandbox.execute(
        'echo "test" > /tmp/test.txt && cat /tmp/test.txt',
        { workDir, image: 'alpine:latest' }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('test')
    })
  })
})

describe('isDockerAvailable', () => {
  it('returns a boolean', () => {
    const result = isDockerAvailable()
    expect(typeof result).toBe('boolean')
  })
})
