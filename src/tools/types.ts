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
 *
 * For URL-based targets, includes host, path, and query string (but not fragment)
 * to prevent over-broad approvals. For example, approving DELETE to /api/users?id=1
 * should NOT approve DELETE to /api/users?id=2.
 *
 * For command-based targets, normalizes but preserves the full command.
 */
export function computeApprovalId(
  tool: string,
  action: string,
  target: string
): string {
  // Reject empty targets - each approval must have a specific target
  if (!target || target.trim() === '') {
    throw new Error('Approval target cannot be empty')
  }

  // Normalize target
  const normalized = normalizeTarget(target)
  return `${tool}:${action}:${normalized}`
}

/**
 * Normalize target for approval ID.
 *
 * For URLs: includes host, path, and query string (important for API endpoints).
 * Query parameters are sorted for consistent IDs regardless of order.
 * Fragments are excluded as they don't affect server-side behavior.
 *
 * For non-URLs (commands, paths): lowercase and trim, but preserve
 * enough detail to differentiate commands.
 */
function normalizeTarget(target: string): string {
  // Try to parse as URL
  try {
    const url = new URL(target)
    // Lowercase host
    const host = url.host.toLowerCase()
    // Keep path, remove trailing slash
    const path = url.pathname.replace(/\/$/, '') || '/'

    // Include query string if present (important for API endpoints)
    // Sort query params for consistent IDs regardless of order
    let query = ''
    if (url.search) {
      const params = new URLSearchParams(url.search)
      // Sort parameters alphabetically
      params.sort()
      query = '?' + params.toString()
    }

    return `${host}${path}${query}`
  } catch {
    // Not a URL (command, path, etc.)
    // Lowercase and trim, but keep more detail for commands
    // Limit to 200 chars to prevent extremely long IDs
    return target.toLowerCase().trim().slice(0, 200)
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
