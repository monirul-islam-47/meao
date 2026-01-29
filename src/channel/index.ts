// Types
export type {
  MessageType,
  BaseMessage,
  UserMessage,
  AssistantMessage,
  ToolUseMessage,
  ToolResultMessage,
  ErrorMessage,
  SystemMessage,
  ApprovalRequestMessage,
  ApprovalResponseMessage,
  StreamStartMessage,
  StreamDeltaMessage,
  StreamEndMessage,
  ChannelMessage,
  ChannelState,
  ChannelEvents,
  ChannelEventEmitter,
  Channel,
} from './types.js'

// Event emitter
export { TypedEventEmitter } from './emitter.js'

// Base channel
export { BaseChannel } from './base.js'

// CLI channel
export { CLIChannel, type CLIChannelOptions } from './cli.js'

// Telegram channel
export {
  TelegramChannel,
  type TelegramChannelConfig,
  type DmPolicy,
  RateLimiter,
  type RateLimitConfig,
  TelegramApprovalUI,
} from './telegram/index.js'
export {
  createTelegramChannel,
  createAndConnectTelegramChannel,
  type CreateTelegramChannelOptions,
} from './telegram/bot.js'
