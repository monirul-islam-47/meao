import { spawn } from 'child_process'
import type { ProcessConfig, ExecutionResult } from './types.js'
import { DEFAULT_PROCESS_CONFIG } from './types.js'

/**
 * Process sandbox for executing commands in a restricted process.
 *
 * Features:
 * - Clean environment (only explicit env vars)
 * - Working directory restriction
 * - Timeout enforcement
 * - Output size limiting
 */
export class ProcessSandbox {
  /**
   * Execute a command in a sandboxed process.
   */
  async execute(
    command: string,
    config: Partial<ProcessConfig> & { workDir: string }
  ): Promise<ExecutionResult> {
    const fullConfig: ProcessConfig = {
      ...DEFAULT_PROCESS_CONFIG,
      ...config,
    }

    const startTime = Date.now()

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let truncated = false
      let timedOut = false

      // Build clean environment
      const env = this.buildCleanEnv(fullConfig.env)

      // Spawn the process
      const child = spawn(fullConfig.shell || '/bin/sh', ['-c', command], {
        cwd: fullConfig.workDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // Set timeout
      const timeoutId = setTimeout(() => {
        timedOut = true
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
   * Build a clean environment with only explicit vars.
   */
  private buildCleanEnv(
    explicitEnv?: Record<string, string>
  ): Record<string, string> {
    // Start with minimal safe environment
    const cleanEnv: Record<string, string> = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/tmp',
      LANG: 'en_US.UTF-8',
      TERM: 'dumb',
    }

    // Add explicit env vars
    if (explicitEnv) {
      Object.assign(cleanEnv, explicitEnv)
    }

    return cleanEnv
  }
}
