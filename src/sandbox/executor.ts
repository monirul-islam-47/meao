import type {
  SandboxLevel,
  ExecutionResult,
  ProcessConfig,
  ContainerConfig,
} from './types.js'
import { DEFAULT_SANDBOX_LEVELS } from './types.js'
import { ProcessSandbox } from './process.js'
import { ContainerSandbox, isDockerAvailable } from './container/index.js'

/**
 * Configuration for the sandbox executor.
 */
export interface SandboxExecutorConfig {
  workDir: string
  processConfig?: Partial<ProcessConfig>
  containerConfig?: Partial<ContainerConfig>
  sandboxLevels?: Record<string, SandboxLevel>
  /**
   * If true, allow fallback to ProcessSandbox when container is required but Docker unavailable.
   * Default: false (fail closed for security)
   */
  allowContainerFallback?: boolean
}

/**
 * Per-execution options that override defaults.
 */
export interface ExecutionOptions {
  workDir?: string
  timeout?: number
}

/**
 * Unified sandbox executor that picks the appropriate isolation level.
 */
export class SandboxExecutor {
  private processSandbox: ProcessSandbox
  private containerSandbox: ContainerSandbox
  private config: SandboxExecutorConfig
  private sandboxLevels: Record<string, SandboxLevel>

  constructor(config: SandboxExecutorConfig) {
    this.config = config
    this.processSandbox = new ProcessSandbox()
    this.containerSandbox = new ContainerSandbox()
    this.sandboxLevels = {
      ...DEFAULT_SANDBOX_LEVELS,
      ...config.sandboxLevels,
    }
  }

  /**
   * Execute a command with appropriate sandbox isolation.
   *
   * @param command - The command to execute
   * @param toolName - The tool requesting execution (determines sandbox level)
   * @param options - Optional per-execution overrides for workDir and timeout
   */
  async execute(
    command: string,
    toolName: string,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const level = this.getSandboxLevel(toolName)

    switch (level) {
      case 'container':
        return this.executeInContainer(command, options)
      case 'process':
        return this.executeInProcess(command, options)
      case 'none':
        // No sandbox - execute directly (dangerous, for system tools only)
        return this.executeInProcess(command, options)
    }
  }

  /**
   * Get the sandbox level for a tool.
   */
  getSandboxLevel(toolName: string): SandboxLevel {
    return this.sandboxLevels[toolName] ?? 'process'
  }

  /**
   * Check if container sandbox is available.
   */
  isContainerAvailable(): boolean {
    return isDockerAvailable()
  }

  /**
   * Execute in process sandbox.
   */
  private async executeInProcess(
    command: string,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    return this.processSandbox.execute(command, {
      workDir: options?.workDir ?? this.config.workDir,
      ...this.config.processConfig,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
    })
  }

  /**
   * Execute in container sandbox.
   * Fails closed if Docker unavailable unless allowContainerFallback is set.
   */
  private async executeInContainer(
    command: string,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    // Check if Docker is available
    if (!isDockerAvailable()) {
      // Fail closed by default - container isolation was explicitly required
      if (!this.config.allowContainerFallback) {
        return {
          stdout: '',
          stderr: 'Container sandbox required but Docker is not available. ' +
            'Install Docker or set allowContainerFallback: true to use process isolation.',
          exitCode: 1,
          timedOut: false,
          truncated: false,
          executionTime: 0,
        }
      }

      // Explicit fallback allowed - warn and use process sandbox
      console.warn(
        'Docker not available, falling back to process sandbox. ' +
          'Container isolation is recommended for bash commands.'
      )
      return this.executeInProcess(command, options)
    }

    return this.containerSandbox.execute(command, {
      workDir: options?.workDir ?? this.config.workDir,
      ...this.config.containerConfig,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
    })
  }
}
