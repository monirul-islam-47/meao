import type { AuditLogger } from '../audit/index.js'
import type { SandboxLevel, NetworkMode, ExecutionResult } from './types.js'

/**
 * Emit audit event for sandbox execution start.
 */
export async function auditSandboxStart(
  audit: AuditLogger,
  options: {
    requestId?: string
    toolName: string
    sandboxLevel: SandboxLevel
    networkMode: NetworkMode
    command: string
  }
): Promise<void> {
  await audit.log({
    category: 'sandbox',
    action: 'execution_started',
    severity: 'debug',
    requestId: options.requestId,
    metadata: {
      toolName: options.toolName,
      sandboxLevel: options.sandboxLevel,
      networkMode: options.networkMode,
      // Note: Don't log full command, just length
      commandLength: options.command.length,
    },
  })
}

/**
 * Emit audit event for sandbox execution completion.
 */
export async function auditSandboxComplete(
  audit: AuditLogger,
  options: {
    requestId?: string
    toolName: string
    sandboxLevel: SandboxLevel
    result: ExecutionResult
  }
): Promise<void> {
  const severity = options.result.exitCode === 0 ? 'info' : 'warning'

  await audit.log({
    category: 'sandbox',
    action: 'execution_completed',
    severity,
    requestId: options.requestId,
    metadata: {
      toolName: options.toolName,
      sandboxLevel: options.sandboxLevel,
      exitCode: options.result.exitCode,
      timedOut: options.result.timedOut,
      truncated: options.result.truncated,
      executionTime: options.result.executionTime,
      // Note: Don't log actual output
    },
  })
}

/**
 * Emit audit event for network access blocked.
 */
export async function auditNetworkBlocked(
  audit: AuditLogger,
  options: {
    requestId?: string
    toolName: string
    reason: string
    destination?: string
  }
): Promise<void> {
  await audit.log({
    category: 'sandbox',
    action: 'network_blocked',
    severity: 'warning',
    requestId: options.requestId,
    metadata: {
      toolName: options.toolName,
      reason: options.reason,
      destination: options.destination,
    },
  })
}

/**
 * Emit audit event for container unavailable fallback.
 */
export async function auditContainerFallback(
  audit: AuditLogger,
  options: {
    requestId?: string
    toolName: string
  }
): Promise<void> {
  await audit.log({
    category: 'sandbox',
    action: 'container_fallback',
    severity: 'warning',
    requestId: options.requestId,
    metadata: {
      toolName: options.toolName,
      reason: 'Docker not available, using process sandbox',
    },
  })
}
