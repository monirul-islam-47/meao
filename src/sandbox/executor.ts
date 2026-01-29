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
   */
  async execute(
    command: string,
    toolName: string
  ): Promise<ExecutionResult> {
    const level = this.getSandboxLevel(toolName)

    switch (level) {
      case 'container':
        return this.executeInContainer(command)
      case 'process':
        return this.executeInProcess(command)
      case 'none':
        // No sandbox - execute directly (dangerous, for system tools only)
        return this.executeInProcess(command)
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
  private async executeInProcess(command: string): Promise<ExecutionResult> {
    return this.processSandbox.execute(command, {
      workDir: this.config.workDir,
      ...this.config.processConfig,
    })
  }

  /**
   * Execute in container sandbox.
   */
  private async executeInContainer(command: string): Promise<ExecutionResult> {
    // Check if Docker is available
    if (!isDockerAvailable()) {
      // Fall back to process sandbox with warning
      console.warn(
        'Docker not available, falling back to process sandbox. ' +
          'Container isolation is recommended for bash commands.'
      )
      return this.executeInProcess(command)
    }

    return this.containerSandbox.execute(command, {
      workDir: this.config.workDir,
      ...this.config.containerConfig,
    })
  }
}
