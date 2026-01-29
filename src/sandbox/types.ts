/**
 * Sandbox isolation level.
 */
export type SandboxLevel = 'none' | 'process' | 'container'

/**
 * Network access mode.
 */
export type NetworkMode = 'none' | 'proxy' | 'host'

/**
 * Result of a sandboxed execution.
 */
export interface ExecutionResult {
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
  executionTime: number
}

/**
 * Base configuration for sandbox execution.
 */
export interface SandboxConfig {
  timeout: number
  maxOutputSize: number
  workDir: string
}

/**
 * Process sandbox configuration.
 */
export interface ProcessConfig extends SandboxConfig {
  env?: Record<string, string>
  allowedPaths?: string[]
  blockedPaths?: string[]
  shell?: string
}

/**
 * Container sandbox configuration.
 */
export interface ContainerConfig extends SandboxConfig {
  image: string
  memory: string
  cpus: string
  pidsLimit: number
  networkMode: NetworkMode
  mounts?: Array<{
    source: string
    target: string
    readonly: boolean
  }>
  env?: Record<string, string>
}

/**
 * Default sandbox levels by tool type.
 */
export const DEFAULT_SANDBOX_LEVELS: Record<string, SandboxLevel> = {
  read: 'process',
  write: 'process',
  edit: 'process',
  web_fetch: 'process',
  bash: 'container',
  python: 'container',
  node: 'container',
}

/**
 * Default container configuration.
 */
export const DEFAULT_CONTAINER_CONFIG: Omit<ContainerConfig, 'workDir'> = {
  image: 'alpine:latest',
  timeout: 30000,
  maxOutputSize: 1024 * 1024, // 1MB
  memory: '256m',
  cpus: '0.5',
  pidsLimit: 64,
  networkMode: 'none',
}

/**
 * Default process configuration.
 */
export const DEFAULT_PROCESS_CONFIG: Omit<ProcessConfig, 'workDir'> = {
  timeout: 30000,
  maxOutputSize: 1024 * 1024, // 1MB
  shell: '/bin/sh',
}
