// Types
export type {
  SandboxLevel,
  NetworkMode,
  ExecutionResult,
  SandboxConfig,
  ProcessConfig,
  ContainerConfig,
} from './types.js'

export {
  DEFAULT_SANDBOX_LEVELS,
  DEFAULT_CONTAINER_CONFIG,
  DEFAULT_PROCESS_CONFIG,
} from './types.js'

// Process sandbox
export { ProcessSandbox } from './process.js'

// Container sandbox
export { ContainerSandbox, isDockerAvailable } from './container/index.js'

// Unified executor
export {
  SandboxExecutor,
  type SandboxExecutorConfig,
  type ExecutionOptions,
} from './executor.js'

// Audit helpers
export {
  auditSandboxStart,
  auditSandboxComplete,
  auditNetworkBlocked,
  auditContainerFallback,
} from './audit.js'
