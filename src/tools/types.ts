import type { z } from 'zod'
import type { ContentLabel } from '../security/labels/types.js'
import type { SandboxExecutor } from '../sandbox/executor.js'
import type { AuditLogger } from '../audit/service.js'

/**
 * Tool action declaration.
 * Format: <tool>:<action> or <tool>:<category>:<action>
 */
export interface ToolAction {
  tool: string
  action: string
  category?: string
  affectsOthers: boolean
  isDestructive: boolean
  hasFinancialImpact: boolean
}

/**
 * Tool capability for security policy.
 */
export interface ToolCapability {
  name: string
  approval: {
    level: 'auto' | 'ask' | 'always'
    dangerPatterns?: RegExp[]
    conditions?: {
      methodRequiresApproval?: string[]
      unknownHostRequiresApproval?: boolean
    }
  }
  execution?: {
    sandbox: 'none' | 'process' | 'container'
    networkDefault: 'none' | 'proxy' | 'host'
  }
  network?: {
    mode: 'allowlist' | 'blocklist'
    allowedHosts?: string[]
    blockedHosts?: string[]
    blockedPorts?: number[]
    blockPrivateIPs?: boolean
    blockMetadataEndpoints?: boolean
  }
  labels?: {
    outputTrust: 'untrusted' | 'verified' | 'user' | 'system'
    outputDataClass: 'public' | 'internal' | 'sensitive' | 'secret'
    acceptsUntrusted?: boolean
  }
  // Note: Tool args and output are NEVER logged to audit trail per AUDIT.md
  // security policy. This prevents accidental leakage of sensitive data.
  // The audit system only logs metadata (tool name, success, execution time).
}

/**
 * Raw output from tool execution.
 */
export interface ToolOutput {
  success: boolean
  output: string
  exitCode?: number | null
}

/**
 * Processed result of tool execution.
 */
export interface ToolResult {
  success: boolean
  output: string
  label: ContentLabel
  truncated: boolean
  executionTime: number
}

/**
 * Context passed to tool execution.
 */
export interface ToolContext {
  requestId: string
  sessionId: string
  workDir: string
  approvals: string[]
  sandbox: SandboxExecutor
  audit: AuditLogger
}

/**
 * Tool plugin interface.
 */
export interface ToolPlugin {
  name: string
  description: string
  parameters: z.ZodSchema
  capability: ToolCapability
  actions: ToolAction[]
  execute(args: unknown, context: ToolContext): Promise<ToolOutput>
}

/**
 * Approval request.
 */
export interface ApprovalRequest {
  id: string
  tool: string
  action: string
  target: string
  reason: string
  isDangerous: boolean
}

/**
 * Format a tool action as canonical string.
 */
export function formatAction(action: ToolAction): string {
  if (action.category) {
    return `${action.tool}:${action.category}:${action.action}`
  }
  return `${action.tool}:${action.action}`
}

/**
 * Check if an action matches a pattern (supports wildcards).
 */
export function matchesActionPattern(action: string, pattern: string): boolean {
  if (action === pattern) return true

  // Wildcard: 'tool:*' matches 'tool:action'
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1)
    return action.startsWith(prefix)
  }

  return false
}

/**
 * Compute canonical approval ID.
 */
export function computeApprovalId(
  tool: string,
  action: string,
  target: string
): string {
  // Normalize target
  const normalized = normalizeTarget(target)
  return `${tool}:${action}:${normalized}`
}

/**
 * Normalize target for approval ID.
 */
function normalizeTarget(target: string): string {
  // Try to parse as URL
  try {
    const url = new URL(target)
    // Lowercase host, keep path, remove trailing slash
    const path = url.pathname.replace(/\/$/, '') || '/'
    return `${url.host.toLowerCase()}${path}`
  } catch {
    // Not a URL, just lowercase and trim
    return target.toLowerCase().trim().slice(0, 100)
  }
}

/**
 * Output size caps by tool.
 */
export const OUTPUT_CAPS: Record<string, number> = {
  web_fetch: 50_000,
  bash: 100_000,
  read: 200_000,
  default: 50_000,
}
