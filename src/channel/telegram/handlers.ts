/**
 * Telegram message and command handlers.
 *
 * Sets up handlers for:
 * - /start, /help, /clear commands
 * - Text messages
 * - Callback queries (for approval buttons)
 */

import type { Telegraf } from 'telegraf'
import type { Message } from 'telegraf/types'
import type { TelegramApprovalUI } from './approval.js'

/**
 * Handler callbacks for message processing.
 */
export interface TelegramHandlerCallbacks {
  /**
   * Called when a text message is received.
   * @param telegramUserId - Telegram user ID
   * @param chatId - Chat ID
   * @param text - Message text
   * @param message - Full message object
   */
  onTextMessage: (
    telegramUserId: string,
    chatId: number,
    text: string,
    message: Message.TextMessage
  ) => Promise<void>

  /**
   * Called when /clear command is received.
   * @param telegramUserId - Telegram user ID
   */
  onClearCommand: (telegramUserId: string) => Promise<void>

  /**
   * Check if a user is authorized.
   * @param telegramUserId - Telegram user ID
   */
  isAuthorized: (telegramUserId: string) => boolean

  /**
   * Check if a user is rate limited.
   * @param telegramUserId - Telegram user ID
   */
  checkRateLimit: (telegramUserId: string) => boolean
}

/**
 * Set up all Telegram bot handlers.
 *
 * @param bot - Telegraf bot instance
 * @param approvalUI - Approval UI manager
 * @param callbacks - Handler callbacks
 */
export function setupHandlers(
  bot: Telegraf,
  approvalUI: TelegramApprovalUI,
  callbacks: TelegramHandlerCallbacks
): void {
  // /start command
  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Welcome to meao! Send me a message to get started.\n\n' +
        'Commands:\n' +
        '/help - Show help\n' +
        '/clear - Clear conversation history'
    )
  })

  // /help command
  bot.command('help', async (ctx) => {
    await ctx.reply(
      'meao is your personal AI assistant.\n\n' +
        'Just send a message to chat. I can:\n' +
        '- Browse the web\n' +
        '- Execute commands\n' +
        '- Remember context\n\n' +
        'Some actions require your approval for safety.'
    )
  })

  // /clear command
  bot.command('clear', async (ctx) => {
    const userId = ctx.from?.id.toString()
    if (!userId) {
      await ctx.reply('Could not identify user.')
      return
    }

    if (!callbacks.isAuthorized(userId)) {
      await ctx.reply('Sorry, you are not authorized to use this bot.')
      return
    }

    try {
      await callbacks.onClearCommand(userId)
      await ctx.reply('Conversation cleared.')
    } catch (error) {
      await ctx.reply('Failed to clear conversation.')
    }
  })

  // Text message handler
  bot.on('text', async (ctx) => {
    const message = ctx.message
    const userId = ctx.from?.id.toString()
    const chatId = ctx.chat?.id

    if (!userId || !chatId || !message.text) {
      return
    }

    // Check authorization
    if (!callbacks.isAuthorized(userId)) {
      await ctx.reply('Sorry, you are not authorized to use this bot.')
      return
    }

    // Check rate limit
    if (!callbacks.checkRateLimit(userId)) {
      await ctx.reply('Rate limit exceeded. Please wait before sending more messages.')
      return
    }

    // Show typing indicator
    await ctx.sendChatAction('typing')

    try {
      await callbacks.onTextMessage(userId, chatId, message.text, message)
    } catch (error) {
      console.error('Telegram message handling error:', error)
      await ctx.reply('An error occurred. Please try again.')
    }
  })

  // Callback query handler (for approval buttons)
  bot.on('callback_query', async (ctx) => {
    try {
      await approvalUI.handleCallback(ctx, bot)
    } catch (error) {
      console.error('Callback query error:', error)
      await ctx.answerCbQuery('An error occurred.')
    }
  })

  // Error handler
  bot.catch((error, _ctx) => {
    console.error('Telegraf error:', error)
  })
}

/**
 * Send a typing indicator periodically until stopped.
 *
 * @param bot - Telegraf bot instance
 * @param chatId - Chat ID
 * @returns Stop function
 */
export function startTypingIndicator(bot: Telegraf, chatId: number): () => void {
  const interval = setInterval(async () => {
    try {
      await bot.telegram.sendChatAction(chatId, 'typing')
    } catch {
      // Ignore errors
    }
  }, 4000) // Telegram typing indicator lasts ~5 seconds

  return () => clearInterval(interval)
}
