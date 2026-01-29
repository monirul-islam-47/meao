import type { ApprovalRequest, ToolContext } from './types.js'

/**
 * Approval callback function type.
 */
export type ApprovalCallback = (
  request: ApprovalRequest
) => Promise<boolean>

/**
 * Manager for tool approval requests.
 */
export class ApprovalManager {
  private callback: ApprovalCallback

  constructor(callback?: ApprovalCallback) {
    // Default: auto-approve everything (for testing)
    this.callback = callback ?? (async () => true)
  }

  /**
   * Set the approval callback.
   */
  setCallback(callback: ApprovalCallback): void {
    this.callback = callback
  }

  /**
   * Request approval for a tool action.
   */
  async request(
    request: ApprovalRequest,
    _context: ToolContext
  ): Promise<boolean> {
    return this.callback(request)
  }

  /**
   * Check if an approval is already granted.
   */
  hasApproval(context: ToolContext, approvalId: string): boolean {
    return context.approvals.includes(approvalId)
  }

  /**
   * Add an approval to the context.
   */
  addApproval(context: ToolContext, approvalId: string): void {
    if (!this.hasApproval(context, approvalId)) {
      context.approvals.push(approvalId)
    }
  }
}

/**
 * Create an approval manager that always approves.
 */
export function createAutoApproveManager(): ApprovalManager {
  return new ApprovalManager(async () => true)
}

/**
 * Create an approval manager that always denies.
 */
export function createDenyAllManager(): ApprovalManager {
  return new ApprovalManager(async () => false)
}

/**
 * Create an approval manager that prompts the user.
 */
export function createInteractiveManager(
  promptFn: (message: string) => Promise<boolean>
): ApprovalManager {
  return new ApprovalManager(async (request) => {
    const message = formatApprovalMessage(request)
    return promptFn(message)
  })
}

/**
 * Format an approval request for display.
 */
function formatApprovalMessage(request: ApprovalRequest): string {
  let message = `Tool "${request.tool}" wants to: ${request.action}`

  if (request.target) {
    message += `\nTarget: ${request.target}`
  }

  if (request.reason) {
    message += `\nReason: ${request.reason}`
  }

  if (request.isDangerous) {
    message += '\n⚠️  This action may be dangerous!'
  }

  return message
}
