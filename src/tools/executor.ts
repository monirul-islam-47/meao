import type {
  ToolPlugin,
  ToolContext,
  ToolResult,
  ApprovalRequest,
} from './types.js'
import { OUTPUT_CAPS, computeApprovalId } from './types.js'
import { ApprovalManager } from './approvals.js'
import { secretDetector } from '../security/secrets/index.js'
import { wrapToolOutput } from '../security/sanitize/index.js'
import { labelOutput } from '../security/labels/output.js'
import { networkGuard } from '../security/network/index.js'
import type { ContentLabel } from '../security/labels/types.js'

/**
 * Tool executor - the enforcement pipeline for tool execution.
 *
 * Handles:
 * 1. Argument validation
 * 2. Approval flow
 * 3. Network enforcement
 * 4. Execution
 * 5. Output sanitization
 * 6. Labeling
 * 7. Audit logging
 */
export class ToolExecutor {
  private approvalManager: ApprovalManager

  constructor(approvalManager?: ApprovalManager) {
    this.approvalManager = approvalManager ?? new ApprovalManager()
  }

  /**
   * Execute a tool with full enforcement pipeline.
   */
  async execute(
    tool: ToolPlugin,
    args: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now()

    try {
      // 1. Validate arguments
      const validatedArgs = tool.parameters.parse(args)

      // 2. Compute required approvals
      const requiredApprovals = this.computeApprovals(tool, validatedArgs)

      // 3. Request any missing approvals
      for (const approval of requiredApprovals) {
        if (!this.approvalManager.hasApproval(context, approval.id)) {
          const granted = await this.approvalManager.request(approval, context)
          if (!granted) {
            await this.auditDenied(tool, validatedArgs, approval, context)
            return this.createDeniedResult(approval, startTime)
          }
          this.approvalManager.addApproval(context, approval.id)
        }
      }

      // 4. Enforce network rules (for tools with network capability)
      if (tool.capability.network) {
        const networkResult = await this.enforceNetwork(tool, validatedArgs)
        if (!networkResult.allowed) {
          return this.createNetworkBlockedResult(networkResult.reason, startTime)
        }
      }

      // 5. Execute the tool
      const rawOutput = await tool.execute(validatedArgs, context)

      // 6. Sanitize output with secretDetector
      const { redacted, findings } = secretDetector.redact(rawOutput.output)

      // 7. Truncate output
      const truncatedOutput = this.truncateOutput(redacted, tool.capability.name)
      const truncated = truncatedOutput.length < redacted.length

      // 8. Wrap output with DATA markers (prompt-injection hardening)
      const wrappedOutput = wrapToolOutput(tool.name, truncatedOutput)

      // 9. Apply labels
      const label = labelOutput(tool.capability, findings)

      // 10. Emit audit event
      await this.auditExecution(tool, validatedArgs, context, {
        success: rawOutput.success,
        executionTime: Date.now() - startTime,
        secretsFound: findings.length,
        truncated,
      })

      return {
        success: rawOutput.success,
        output: wrappedOutput,
        label,
        truncated,
        executionTime: Date.now() - startTime,
      }
    } catch (error) {
      // Handle validation or execution errors
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      await this.auditError(tool, args, context, errorMessage)

      return {
        success: false,
        output: `Error: ${errorMessage}`,
        label: this.createErrorLabel(tool),
        truncated: false,
        executionTime: Date.now() - startTime,
      }
    }
  }

  /**
   * Compute required approvals for a tool call.
   *
   * Each approval is tied to a specific target (command, path, or URL).
   * Empty targets are not allowed to prevent over-broad approvals.
   */
  private computeApprovals(
    tool: ToolPlugin,
    args: Record<string, unknown>
  ): ApprovalRequest[] {
    const approvals: ApprovalRequest[] = []
    const capability = tool.capability

    // Extract target from args - prioritize in order: command, path, url
    const target = this.extractTarget(args)

    // Check if tool always requires approval
    if (capability.approval.level === 'always') {
      // Require a valid target for approval ID
      if (!target) {
        throw new Error(
          `Tool ${tool.name} requires approval but no target could be extracted from args`
        )
      }

      approvals.push({
        id: computeApprovalId(tool.name, 'execute', target),
        tool: tool.name,
        action: 'execute',
        target,
        reason: 'Tool requires approval for all operations',
        isDangerous: false,
      })
      return approvals
    }

    // Check if tool requires approval on ask
    if (capability.approval.level === 'ask') {
      // Require a valid target for approval ID
      if (!target) {
        throw new Error(
          `Tool ${tool.name} requires approval but no target could be extracted from args`
        )
      }

      const isDangerous = this.isDangerousCommand(capability, target)

      approvals.push({
        id: computeApprovalId(tool.name, 'execute', target),
        tool: tool.name,
        action: 'execute',
        target,
        reason: isDangerous
          ? 'Command matches dangerous pattern'
          : 'Tool requires approval',
        isDangerous,
      })
      return approvals
    }

    // Auto approval - check conditions
    if (capability.approval.conditions) {
      const conditions = capability.approval.conditions

      // Check method-based approval
      if (conditions.methodRequiresApproval && args.method && args.url) {
        const method = String(args.method).toUpperCase()
        const urlStr = String(args.url).trim()

        if (conditions.methodRequiresApproval.includes(method) && urlStr) {
          approvals.push({
            id: computeApprovalId(tool.name, method, urlStr),
            tool: tool.name,
            action: method,
            target: urlStr,
            reason: `${method} method requires approval`,
            isDangerous: false,
          })
        }
      }

      // Check unknown host approval
      if (conditions.unknownHostRequiresApproval && args.url) {
        const urlStr = String(args.url).trim()
        if (urlStr) {
          try {
            const url = new URL(urlStr)
            if (!this.isKnownHost(url.hostname, capability.network?.allowedHosts)) {
              approvals.push({
                id: computeApprovalId(tool.name, 'access', url.hostname),
                tool: tool.name,
                action: 'access',
                target: url.hostname,
                reason: 'Unknown host requires approval',
                isDangerous: false,
              })
            }
          } catch {
            // Invalid URL will be caught by validation
          }
        }
      }
    }

    return approvals
  }

  /**
   * Check if a command matches dangerous patterns.
   */
  private isDangerousCommand(
    capability: ToolPlugin['capability'],
    command: string
  ): boolean {
    if (!capability.approval.dangerPatterns) return false

    return capability.approval.dangerPatterns.some((pattern) =>
      pattern.test(command)
    )
  }

  /**
   * Check if a host is in the known hosts list.
   */
  private isKnownHost(hostname: string, allowedHosts?: string[]): boolean {
    if (!allowedHosts) return false

    return allowedHosts.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1)
        return hostname.endsWith(suffix) || hostname === pattern.slice(2)
      }
      return hostname === pattern
    })
  }

  /**
   * Extract target from tool args.
   *
   * Priority: command > path > url
   * Returns undefined if no valid target found.
   */
  private extractTarget(args: Record<string, unknown>): string | undefined {
    // Check in priority order
    for (const key of ['command', 'path', 'url']) {
      const value = args[key]
      if (value !== undefined && value !== null) {
        const str = String(value).trim()
        if (str.length > 0) {
          return str
        }
      }
    }
    return undefined
  }

  /**
   * Enforce network rules for a tool.
   *
   * Checks both global network policy AND tool-specific policy.
   */
  private async enforceNetwork(
    tool: ToolPlugin,
    args: Record<string, unknown>
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!args.url) return { allowed: true }

    const url = String(args.url)
    const method = String(args.method ?? 'GET')

    // Pass tool's network policy for enforcement
    return networkGuard.checkUrl(url, method, tool.capability.network)
  }

  /**
   * Truncate output to capability-specific cap.
   */
  private truncateOutput(output: string, toolName: string): string {
    const cap = OUTPUT_CAPS[toolName] ?? OUTPUT_CAPS.default
    if (output.length <= cap) return output

    const truncated = output.slice(0, cap)
    return truncated + `\n[TRUNCATED: ${output.length - cap} bytes omitted]`
  }

  /**
   * Create a denied result.
   */
  private createDeniedResult(
    approval: ApprovalRequest,
    startTime: number
  ): ToolResult {
    return {
      success: false,
      output: `Approval denied for ${approval.action}`,
      label: {
        trustLevel: 'system',
        dataClass: 'internal',
        source: { origin: 'approval_denied', timestamp: new Date() },
      },
      truncated: false,
      executionTime: Date.now() - startTime,
    }
  }

  /**
   * Create a network blocked result.
   */
  private createNetworkBlockedResult(
    reason: string | undefined,
    startTime: number
  ): ToolResult {
    return {
      success: false,
      output: `Network access blocked: ${reason ?? 'Unknown reason'}`,
      label: {
        trustLevel: 'system',
        dataClass: 'internal',
        source: { origin: 'network_blocked', timestamp: new Date() },
      },
      truncated: false,
      executionTime: Date.now() - startTime,
    }
  }

  /**
   * Create an error label.
   */
  private createErrorLabel(tool: ToolPlugin): ContentLabel {
    return {
      trustLevel: tool.capability.labels?.outputTrust ?? 'verified',
      dataClass: tool.capability.labels?.outputDataClass ?? 'internal',
      source: { origin: `tool:${tool.name}:error`, timestamp: new Date() },
    }
  }

  /**
   * Audit a denied approval.
   */
  private async auditDenied(
    tool: ToolPlugin,
    args: unknown,
    approval: ApprovalRequest,
    context: ToolContext
  ): Promise<void> {
    await context.audit.log({
      category: 'tool',
      action: 'approval_denied',
      severity: 'warning',
      requestId: context.requestId,
      sessionId: context.sessionId,
      metadata: {
        toolName: tool.name,
        approvalId: approval.id,
        approvalAction: approval.action,
        isDangerous: approval.isDangerous,
      },
    })
  }

  /**
   * Audit a successful execution.
   */
  private async auditExecution(
    tool: ToolPlugin,
    args: unknown,
    context: ToolContext,
    result: {
      success: boolean
      executionTime: number
      secretsFound: number
      truncated: boolean
    }
  ): Promise<void> {
    await context.audit.log({
      category: 'tool',
      action: 'executed',
      severity: result.success ? 'info' : 'warning',
      requestId: context.requestId,
      sessionId: context.sessionId,
      metadata: {
        toolName: tool.name,
        success: result.success,
        executionTime: result.executionTime,
        secretsFound: result.secretsFound,
        truncated: result.truncated,
        // Note: args and output NOT logged per AUDIT.md
      },
    })
  }

  /**
   * Audit an error.
   */
  private async auditError(
    tool: ToolPlugin,
    _args: unknown,
    context: ToolContext,
    errorMessage: string
  ): Promise<void> {
    await context.audit.log({
      category: 'tool',
      action: 'error',
      severity: 'alert',
      requestId: context.requestId,
      sessionId: context.sessionId,
      metadata: {
        toolName: tool.name,
        errorMessage, // Will be sanitized by audit system
      },
    })
  }
}
