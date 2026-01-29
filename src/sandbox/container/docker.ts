import { spawn, execSync } from 'child_process'
import type { ContainerConfig, ExecutionResult } from '../types.js'
import { DEFAULT_CONTAINER_CONFIG } from '../types.js'

/**
 * Check if Docker is available.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Container sandbox using Docker for strong isolation.
 *
 * Features:
 * - Network isolation (--network=none by default)
 * - Capability dropping (--cap-drop=ALL)
 * - Non-root execution (--user=nobody)
 * - Read-only root filesystem (--read-only)
 * - Resource limits (memory, CPU, PIDs)
 */
export class ContainerSandbox {
  /**
   * Execute a command in a Docker container.
   */
  async execute(
    command: string,
    config: Partial<ContainerConfig> & { workDir: string }
  ): Promise<ExecutionResult> {
    const fullConfig: ContainerConfig = {
      ...DEFAULT_CONTAINER_CONFIG,
      ...config,
    }

    if (!isDockerAvailable()) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Docker is not available',
        truncated: false,
        timedOut: false,
        executionTime: 0,
      }
    }

    const startTime = Date.now()

    // Build Docker run arguments
    const args = this.buildDockerArgs(command, fullConfig)

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let truncated = false
      let timedOut = false

      const child = spawn('docker', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // Set timeout
      const timeoutId = setTimeout(() => {
        timedOut = true
        // Kill the docker process (which will stop the container)
        child.kill('SIGKILL')
      }, fullConfig.timeout)

      // Capture stdout with size limit
      child.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < fullConfig.maxOutputSize) {
          const remaining = fullConfig.maxOutputSize - stdout.length
          stdout += data.toString().slice(0, remaining)
          if (data.length > remaining) {
            truncated = true
          }
        } else {
          truncated = true
        }
      })

      // Capture stderr with size limit
      child.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < fullConfig.maxOutputSize) {
          const remaining = fullConfig.maxOutputSize - stderr.length
          stderr += data.toString().slice(0, remaining)
          if (data.length > remaining) {
            truncated = true
          }
        } else {
          truncated = true
        }
      })

      // Handle completion
      child.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve({
          exitCode: code,
          stdout,
          stderr,
          truncated,
          timedOut,
          executionTime: Date.now() - startTime,
        })
      })

      // Handle errors
      child.on('error', (error) => {
        clearTimeout(timeoutId)
        resolve({
          exitCode: null,
          stdout,
          stderr: stderr + (stderr ? '\n' : '') + error.message,
          truncated,
          timedOut,
          executionTime: Date.now() - startTime,
        })
      })
    })
  }

  /**
   * Build Docker run arguments with all security hardening.
   */
  private buildDockerArgs(
    command: string,
    config: ContainerConfig
  ): string[] {
    const args: string[] = [
      'run',
      '--rm', // Remove container after execution

      // Network isolation - MVP ALWAYS uses none
      '--network=none',

      // Security hardening
      '--read-only', // Read-only root filesystem
      '--cap-drop=ALL', // Drop all capabilities
      '--user=nobody', // Non-root user
      '--security-opt=no-new-privileges', // Prevent privilege escalation

      // Resource limits
      `--memory=${config.memory}`,
      `--cpus=${config.cpus}`,
      `--pids-limit=${config.pidsLimit}`,

      // Tmpfs for writable directories
      '--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
    ]

    // Mount working directory
    args.push('-v', `${config.workDir}:/workspace:rw`)
    args.push('-w', '/workspace')

    // Add additional mounts
    if (config.mounts) {
      for (const mount of config.mounts) {
        const mode = mount.readonly ? 'ro' : 'rw'
        args.push('-v', `${mount.source}:${mount.target}:${mode}`)
      }
    }

    // Add environment variables
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`)
      }
    }

    // Image and command
    args.push(config.image)
    args.push('/bin/sh', '-c', command)

    return args
  }
}
