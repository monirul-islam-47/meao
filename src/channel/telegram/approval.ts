/**
 * Telegram approval UI using inline keyboards.
 *
 * Displays approval requests with Allow/Deny/Details buttons
 * and handles callback queries to resolve approvals.
 */

import type { Telegraf, Context } from 'telegraf'
import type {
  ApprovalRequestMessage,
  ApprovalResponseMessage,
} from '../types.js'
import { randomUUID } from 'crypto'

/**
 * Pending approval state.
 */
interface PendingApproval {
  resolve: (response: ApprovalResponseMessage) => void
  chatId: number
  messageId: number
  request: ApprovalRequestMessage
  timeoutId: NodeJS.Timeout
}

/**
 * Telegram approval UI manager.
 *
 * Handles displaying approval requests as inline keyboards
 * and processing callback queries from button clicks.
 */
export class TelegramApprovalUI {
  private pending = new Map<string, PendingApproval>()
  private approvalTimeout: number

  constructor(approvalTimeout: number = 60_000) {
    this.approvalTimeout = approvalTimeout
  }

  /**
   * Show an approval request in Telegram with inline keyboard.
   *
   * @param bot - Telegraf bot instance
   * @param chatId - Chat to send approval to
   * @param request - Approval request message
   * @returns Promise that resolves when user responds or times out
   */
  async showApproval(
    bot: Telegraf,
    chatId: number,
    request: ApprovalRequestMessage
  ): Promise<ApprovalResponseMessage> {
    return new Promise(async (resolve) => {
      const requestId = request.approvalId

      // Format the approval message
      const text = this.formatApprovalRequest(request)

      // Send message with inline keyboard
      const message = await bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Allow', callback_data: `approve:${requestId}:yes` },
              { text: 'Deny', callback_data: `approve:${requestId}:no` },
            ],
            [{ text: 'Show Details', callback_data: `approve:${requestId}:details` }],
          ],
        },
      })

      // Set up timeout
      const timeoutId = setTimeout(async () => {
        const pending = this.pending.get(requestId)
        if (pending) {
          this.pending.delete(requestId)

          // Update message to show timeout
          await this.updateApprovalMessage(
            bot,
            pending.chatId,
            pending.messageId,
            'Approval timed out'
          )

          // Resolve with denial
          resolve({
            type: 'approval_response',
            id: randomUUID(),
            timestamp: new Date(),
            sessionId: request.sessionId,
            approvalId: requestId,
            approved: false,
          })
        }
      }, this.approvalTimeout)

      // Store pending approval
      this.pending.set(requestId, {
        resolve,
        chatId,
        messageId: message.message_id,
        request,
        timeoutId,
      })
    })
  }

  /**
   * Handle a callback query from an inline button click.
   *
   * @param ctx - Telegraf context
   * @param bot - Telegraf bot instance
   * @returns Approval response if this was an approval callback, null otherwise
   */
  async handleCallback(
    ctx: Context,
    bot: Telegraf
  ): Promise<ApprovalResponseMessage | null> {
    const callbackQuery = ctx.callbackQuery
    if (!callbackQuery || !('data' in callbackQuery)) {
      return null
    }

    const data = callbackQuery.data
    const [action, requestId, choice] = data.split(':')

    if (action !== 'approve') {
      return null
    }

    const pending = this.pending.get(requestId)
    if (!pending) {
      await ctx.answerCbQuery('This approval has expired.')
      return null
    }

    // Handle "Show Details" button
    if (choice === 'details') {
      const detailsText = this.formatApprovalDetails(pending.request)
      await bot.telegram.sendMessage(pending.chatId, detailsText, {
        parse_mode: 'Markdown',
        reply_parameters: { message_id: pending.messageId },
      })
      await ctx.answerCbQuery('Details sent.')
      return null
    }

    // Handle Allow/Deny
    const approved = choice === 'yes'
    this.pending.delete(requestId)
    clearTimeout(pending.timeoutId)

    // Update the message
    const resultText = approved ? 'Approved' : 'Denied'
    await this.updateApprovalMessage(bot, pending.chatId, pending.messageId, `Decision: ${resultText}`)

    await ctx.answerCbQuery(resultText)

    // Create response
    const response: ApprovalResponseMessage = {
      type: 'approval_response',
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: pending.request.sessionId,
      approvalId: requestId,
      approved,
    }

    // Resolve the promise
    pending.resolve(response)

    return response
  }

  /**
   * Format an approval request for display.
   */
  private formatApprovalRequest(request: ApprovalRequestMessage): string {
    let text = `*Approval Required*\n\n`
    text += `Tool: \`${request.tool}\`\n`
    text += `Action: ${request.action}\n`

    if (request.target) {
      text += `Target: \`${request.target}\`\n`
    }

    if (request.reason) {
      text += `\nReason: ${request.reason}\n`
    }

    if (request.isDangerous) {
      text += `\n*Warning: This action is potentially dangerous*\n`
    }

    return text
  }

  /**
   * Format detailed approval information.
   */
  private formatApprovalDetails(request: ApprovalRequestMessage): string {
    let text = `*Full Details*\n\n`
    text += `Tool: \`${request.tool}\`\n`
    text += `Action: ${request.action}\n`

    if (request.target) {
      text += `Target: \`${request.target}\`\n`
    }

    if (request.reason) {
      text += `Reason: ${request.reason}\n`
    }

    text += `\nDangerous: ${request.isDangerous ? 'Yes' : 'No'}\n`
    text += `Approval ID: \`${request.approvalId}\`\n`

    return text
  }

  /**
   * Update an approval message after decision.
   */
  private async updateApprovalMessage(
    bot: Telegraf,
    chatId: number,
    messageId: number,
    newText: string
  ): Promise<void> {
    try {
      await bot.telegram.editMessageText(chatId, messageId, undefined, newText, {
        parse_mode: 'Markdown',
      })
    } catch {
      // Message may have been deleted or is unchanged
    }
  }

  /**
   * Check if there are pending approvals.
   */
  hasPending(): boolean {
    return this.pending.size > 0
  }

  /**
   * Cancel all pending approvals.
   */
  cancelAll(): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.resolve({
        type: 'approval_response',
        id: randomUUID(),
        timestamp: new Date(),
        sessionId: pending.request.sessionId,
        approvalId: requestId,
        approved: false,
      })
    }
    this.pending.clear()
  }
}
