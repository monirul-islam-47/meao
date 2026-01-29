/**
 * Telegram Channel Implementation
 *
 * Implements the Channel interface for Telegram, enabling mobile access
 * to meao via Telegram bots.
 *
 * Features:
 * - Message routing to/from Telegram
 * - Simulated streaming (message edits)
 * - Approval via inline keyboards
 * - Rate limiting per user
 * - Authorization policies (owner_only, allowlist, anyone)
 */

import { Telegraf } from 'telegraf'
import type { Message } from 'telegraf/types'
import { randomUUID } from 'crypto'

import { BaseChannel } from '../base.js'
import type {
  ChannelMessage,
  UserMessage,
  AssistantMessage,
  ApprovalRequestMessage,
  StreamDeltaMessage,
  StreamEndMessage,
  ErrorMessage,
} from '../types.js'
import { RateLimiter, type RateLimitConfig } from './rate-limit.js'
import { TelegramApprovalUI } from './approval.js'
import { setupHandlers } from './handlers.js'
import { splitMessage } from './formatting.js'
import { extractAttachments } from './media.js'

/**
 * DM policy for controlling who can interact with the bot.
 */
export type DmPolicy = 'owner_only' | 'allowlist' | 'anyone'

/**
 * Configuration for TelegramChannel.
 */
export interface TelegramChannelConfig {
  /** Telegram bot token from BotFather */
  token: string
  /** Telegram user ID of the bot owner */
  ownerId: string
  /** Internal UUID for the owner (maps to meao user ID) */
  ownerUuid: string
  /** Additional allowed Telegram user IDs */
  allowedUsers?: string[]
  /** Who can interact with the bot */
  dmPolicy: DmPolicy
  /** Rate limit configuration */
  rateLimit: RateLimitConfig
  /** Webhook URL (if using webhook mode instead of polling) */
  webhookUrl?: string
  /** Directory to store downloaded attachments */
  attachmentDir?: string
  /** Approval timeout in milliseconds */
  approvalTimeout?: number
}

/**
 * Stream buffer for simulating streaming via message edits.
 */
interface StreamBuffer {
  content: string
  messageId: number | null
  lastUpdate: number
  chatId: number
}

/**
 * Telegram channel implementation.
 *
 * Extends BaseChannel to provide Telegram-specific functionality.
 */
export class TelegramChannel extends BaseChannel {
  private bot: Telegraf
  private config: TelegramChannelConfig
  private rateLimiter: RateLimiter
  private approvalUI: TelegramApprovalUI

  /** Current chat ID during message processing */
  private currentChatId: number | null = null
  /** Stream buffers keyed by streamId (not chatId) to support parallel streams */
  private streamBuffers = new Map<string, StreamBuffer>()
  /** Per-chat session IDs for user isolation */
  private chatSessions = new Map<number, string>()

  constructor(config: TelegramChannelConfig) {
    super()
    this.config = config
    this.bot = new Telegraf(config.token)
    this.rateLimiter = new RateLimiter(config.rateLimit)
    this.approvalUI = new TelegramApprovalUI(config.approvalTimeout ?? 60_000)

    this.setupHandlers()
  }

  /**
   * Connect the channel (start the bot).
   */
  async connect(): Promise<void> {
    this.setState('connecting')

    try {
      if (this.config.webhookUrl) {
        await this.bot.telegram.setWebhook(this.config.webhookUrl)
      } else {
        // Use polling mode
        await this.bot.launch()
      }

      this.setState('connected')
    } catch (error) {
      this.setState('error')
      throw error
    }
  }

  /**
   * Disconnect the channel (stop the bot).
   *
   * Clears any active streams and pending approvals, emitting errors for incomplete streams.
   */
  async disconnect(): Promise<void> {
    // Clear any active streams with error
    for (const [_streamId, buffer] of this.streamBuffers) {
      // Emit error for incomplete stream
      this.emit('message', {
        type: 'error',
        id: randomUUID(),
        timestamp: new Date(),
        sessionId: this.getSessionIdForChat(buffer.chatId),
        code: 'stream_interrupted',
        message: 'Stream interrupted by channel disconnect',
        recoverable: false,
      })
    }
    this.streamBuffers.clear()

    this.approvalUI.cancelAll()
    this.bot.stop('SIGTERM')
    this.setState('disconnected')
  }

  /**
   * Send a message through the channel.
   *
   * Routes different message types to appropriate Telegram actions.
   */
  async send(message: ChannelMessage): Promise<void> {
    // Can't send without active chat context
    if (this.currentChatId === null) {
      // For messages sent outside of active processing, ignore silently
      return
    }

    const chatId = this.currentChatId

    switch (message.type) {
      case 'assistant_message':
        await this.sendTextResponse(chatId, (message as AssistantMessage).content)
        break

      case 'stream_start': {
        // Initialize stream buffer keyed by streamId
        const startMsg = message as { streamId: string }
        this.streamBuffers.set(startMsg.streamId, {
          content: '',
          messageId: null,
          lastUpdate: 0,
          chatId,
        })
        break
      }

      case 'stream_delta':
        await this.handleStreamDelta(message as StreamDeltaMessage)
        break

      case 'stream_end':
        await this.finalizeStream(message as StreamEndMessage)
        break

      case 'approval_request':
        await this.handleApprovalRequest(chatId, message as ApprovalRequestMessage)
        break

      case 'tool_use':
        // Tool use messages could optionally show a "using X..." indicator
        // but we keep it minimal to avoid noise
        break

      case 'tool_result':
        // Tool results are typically part of the final response
        break

      case 'error':
        const errorMsg = message as ErrorMessage
        await this.bot.telegram.sendMessage(
          chatId,
          `Error: ${errorMsg.message}`,
          { parse_mode: 'Markdown' }
        )
        break
    }

    // Emit message event
    this.emit('message', message)
  }

  /**
   * Get the Telegraf bot instance.
   */
  getBot(): Telegraf {
    return this.bot
  }

  /**
   * Check if a Telegram user is authorized to use the bot.
   */
  isAuthorized(telegramUserId: string): boolean {
    switch (this.config.dmPolicy) {
      case 'owner_only':
        return telegramUserId === this.config.ownerId

      case 'allowlist':
        return (
          telegramUserId === this.config.ownerId ||
          this.config.allowedUsers?.includes(telegramUserId) === true
        )

      case 'anyone':
        return true

      default:
        return false
    }
  }

  /**
   * Map a Telegram user ID to an internal meao user ID.
   *
   * The owner's Telegram ID maps to their configured ownerUuid.
   * Other users get a prefixed ID.
   */
  mapTelegramToUserId(telegramUserId: string): string {
    if (telegramUserId === this.config.ownerId) {
      return this.config.ownerUuid
    }
    return `telegram:${telegramUserId}`
  }

  /**
   * Get or create a stable session ID for a given chat.
   *
   * Each chat gets its own session ID for user isolation.
   */
  getSessionIdForChat(chatId: number): string {
    let sessionId = this.chatSessions.get(chatId)
    if (!sessionId) {
      sessionId = `chat:${chatId}`
      this.chatSessions.set(chatId, sessionId)
    }
    return sessionId
  }

  /**
   * Set up message handlers.
   */
  private setupHandlers(): void {
    setupHandlers(this.bot, this.approvalUI, {
      onTextMessage: async (telegramUserId, chatId, text, message) => {
        await this.handleTextMessage(telegramUserId, chatId, text, message)
      },
      onClearCommand: async (_telegramUserId) => {
        // Emit a clear event that the orchestrator can handle
        // For now, just acknowledge
      },
      isAuthorized: (telegramUserId) => this.isAuthorized(telegramUserId),
      checkRateLimit: (telegramUserId) => this.rateLimiter.check(telegramUserId),
    })
  }

  /**
   * Handle an incoming text message.
   */
  private async handleTextMessage(
    telegramUserId: string,
    chatId: number,
    text: string,
    message: Message.TextMessage
  ): Promise<void> {
    // Set current chat context
    this.currentChatId = chatId

    try {
      // Extract any attachments (for future use with file/image tools)
      // TODO: Pass attachments to orchestrator when multi-modal support is added
      await extractAttachments(
        { telegram: this.bot.telegram } as any, // Simplified context
        message,
        this.config.token,
        this.config.attachmentDir ?? '/tmp/meao-attachments'
      )

      // Create user message
      // Note: We store Telegram-specific metadata in the channel-neutral format
      // using type assertion since UserMessage.metadata is CLI-specific
      const userMessage: UserMessage = {
        type: 'user_message',
        id: randomUUID(),
        timestamp: new Date(message.date * 1000),
        sessionId: this.getSessionIdForChat(chatId),
        content: text,
        metadata: {
          // Store Telegram context for potential use by handlers
          // Using cwd as a hack to pass telegramUserId since metadata type is limited
          cwd: `telegram:${telegramUserId}:${chatId}`,
        },
      }

      // Emit the message for the orchestrator to handle
      this.emit('message', userMessage)
    } finally {
      // Clear chat context after processing completes
      // Note: This should ideally be cleared after the response is fully sent
      // For now, we leave it set until the next message
    }
  }

  /**
   * Send a text response, splitting if necessary.
   */
  private async sendTextResponse(chatId: number, text: string): Promise<void> {
    // Telegram has a 4096 character limit
    const chunks = splitMessage(text, 4000)

    for (const chunk of chunks) {
      try {
        await this.bot.telegram.sendMessage(chatId, chunk, {
          parse_mode: 'Markdown',
        })
      } catch {
        // If Markdown parsing fails, try without formatting
        await this.bot.telegram.sendMessage(chatId, chunk)
      }
    }
  }

  /**
   * Handle a stream delta by buffering and updating message.
   */
  private async handleStreamDelta(delta: StreamDeltaMessage): Promise<void> {
    const buffer = this.streamBuffers.get(delta.streamId)

    if (!buffer) {
      // Stream wasn't started properly, ignore delta
      return
    }

    buffer.content += delta.delta

    // Throttle updates to every 500ms to avoid Telegram rate limits
    const now = Date.now()
    if (now - buffer.lastUpdate < 500) {
      return
    }

    buffer.lastUpdate = now
    await this.updateStreamMessage(buffer.chatId, buffer, false)
  }

  /**
   * Finalize a stream by sending the final message.
   */
  private async finalizeStream(endMessage: StreamEndMessage): Promise<void> {
    const buffer = this.streamBuffers.get(endMessage.streamId)

    if (buffer && buffer.content) {
      await this.updateStreamMessage(buffer.chatId, buffer, true)
    }

    this.streamBuffers.delete(endMessage.streamId)
  }

  /**
   * Update or create the streaming message.
   */
  private async updateStreamMessage(
    chatId: number,
    buffer: StreamBuffer,
    final: boolean
  ): Promise<void> {
    try {
      // Add cursor indicator if not final
      const text = buffer.content + (final ? '' : ' ▌')

      // Truncate if too long for a single message
      const displayText = text.length > 4000 ? text.slice(-4000) : text

      if (buffer.messageId === null) {
        // Send initial message
        const msg = await this.bot.telegram.sendMessage(chatId, displayText || '...', {
          parse_mode: 'Markdown',
        })
        buffer.messageId = msg.message_id
      } else {
        // Edit existing message
        await this.bot.telegram.editMessageText(
          chatId,
          buffer.messageId,
          undefined,
          displayText || '...',
          { parse_mode: 'Markdown' }
        )
      }
    } catch {
      // Telegram may reject edits that don't change content
    }
  }

  /**
   * Handle an approval request.
   */
  private async handleApprovalRequest(
    chatId: number,
    request: ApprovalRequestMessage
  ): Promise<void> {
    const response = await this.approvalUI.showApproval(this.bot, chatId, request)

    // Emit the approval response
    this.emit('message', response)
  }

  /**
   * Clear the current chat context.
   */
  clearChatContext(): void {
    if (this.currentChatId !== null) {
      // Clear any stream buffers associated with this chat
      for (const [streamId, buffer] of this.streamBuffers) {
        if (buffer.chatId === this.currentChatId) {
          this.streamBuffers.delete(streamId)
        }
      }
      this.currentChatId = null
    }
  }
}

// Re-export types and utilities
export { RateLimiter, type RateLimitConfig } from './rate-limit.js'
export { TelegramApprovalUI } from './approval.js'
export { setupHandlers, type TelegramHandlerCallbacks } from './handlers.js'
export { extractAttachments, sanitizeFilename, MAX_FILE_SIZE, type Attachment } from './media.js'
export * from './formatting.js'
