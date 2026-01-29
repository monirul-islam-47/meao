/**
 * Telegram bot lifecycle management.
 *
 * Provides factory functions for creating and configuring
 * TelegramChannel instances.
 */

import { TelegramChannel, type TelegramChannelConfig, type DmPolicy } from './index.js'
import type { RateLimitConfig } from './rate-limit.js'

/**
 * Options for creating a Telegram channel.
 */
export interface CreateTelegramChannelOptions {
  /** Telegram bot token from BotFather */
  token: string
  /** Telegram user ID of the bot owner */
  ownerId: string
  /** Internal UUID for the owner */
  ownerUuid: string
  /** Who can interact with the bot (default: 'owner_only') */
  dmPolicy?: DmPolicy
  /** Additional allowed user IDs (for 'allowlist' mode) */
  allowedUsers?: string[]
  /** Rate limit configuration */
  rateLimit?: Partial<RateLimitConfig>
  /** Webhook URL (uses polling if not provided) */
  webhookUrl?: string
  /** Directory for downloaded attachments */
  attachmentDir?: string
  /** Approval timeout in milliseconds (default: 60000) */
  approvalTimeout?: number
}

/**
 * Default rate limit configuration.
 */
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  messagesPerMinute: 10,
  messagesPerHour: 100,
}

/**
 * Create a configured TelegramChannel instance.
 *
 * @param options - Channel configuration options
 * @returns Configured TelegramChannel (not yet connected)
 */
export function createTelegramChannel(options: CreateTelegramChannelOptions): TelegramChannel {
  const config: TelegramChannelConfig = {
    token: options.token,
    ownerId: options.ownerId,
    ownerUuid: options.ownerUuid,
    dmPolicy: options.dmPolicy ?? 'owner_only',
    allowedUsers: options.allowedUsers,
    rateLimit: {
      ...DEFAULT_RATE_LIMIT,
      ...options.rateLimit,
    },
    webhookUrl: options.webhookUrl,
    attachmentDir: options.attachmentDir,
    approvalTimeout: options.approvalTimeout,
  }

  return new TelegramChannel(config)
}

/**
 * Create and connect a TelegramChannel.
 *
 * @param options - Channel configuration options
 * @returns Connected TelegramChannel
 */
export async function createAndConnectTelegramChannel(
  options: CreateTelegramChannelOptions
): Promise<TelegramChannel> {
  const channel = createTelegramChannel(options)
  await channel.connect()
  return channel
}

// Re-export main types
export type { TelegramChannelConfig, DmPolicy } from './index.js'
