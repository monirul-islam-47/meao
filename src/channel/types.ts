/**
 * Message types for channel communication.
 */
export type MessageType =
  | 'user_message'     // User input
  | 'assistant_message' // Assistant response
  | 'tool_use'         // Tool execution request
  | 'tool_result'      // Tool execution result
  | 'error'            // Error message
  | 'system'           // System notification
  | 'approval_request' // Tool approval request
  | 'approval_response' // User approval response
  | 'stream_start'     // Start of streaming response
  | 'stream_delta'     // Streaming chunk
  | 'stream_end'       // End of streaming response

/**
 * Base message structure.
 */
export interface BaseMessage {
  type: MessageType
  id: string
  timestamp: Date
  sessionId: string
  turnId?: string
}

/**
 * User message from CLI.
 */
export interface UserMessage extends BaseMessage {
  type: 'user_message'
  content: string
  metadata?: {
    cwd?: string
    env?: Record<string, string>
  }
}

/**
 * Assistant response message.
 */
export interface AssistantMessage extends BaseMessage {
  type: 'assistant_message'
  content: string
  thinking?: string
  toolUse?: ToolUseMessage[]
}

/**
 * Tool use request.
 */
export interface ToolUseMessage extends BaseMessage {
  type: 'tool_use'
  name: string
  args: Record<string, unknown>
  correlationId?: string
}

/**
 * Tool execution result.
 */
export interface ToolResultMessage extends BaseMessage {
  type: 'tool_result'
  name: string
  success: boolean
  output: string
  correlationId?: string
}

/**
 * Error message.
 */
export interface ErrorMessage extends BaseMessage {
  type: 'error'
  code: string
  message: string
  recoverable: boolean
  details?: unknown
}

/**
 * System notification.
 */
export interface SystemMessage extends BaseMessage {
  type: 'system'
  event: 'connected' | 'disconnected' | 'rate_limited' | 'context_overflow' | 'cost_update'
  data?: unknown
}

/**
 * Approval request from orchestrator.
 */
export interface ApprovalRequestMessage extends BaseMessage {
  type: 'approval_request'
  tool: string
  action: string
  target?: string
  reason?: string
  isDangerous: boolean
  approvalId: string
}

/**
 * User's approval response.
 */
export interface ApprovalResponseMessage extends BaseMessage {
  type: 'approval_response'
  approvalId: string
  approved: boolean
  rememberSession?: boolean
  rememberAlways?: boolean
}

/**
 * Stream start marker.
 */
export interface StreamStartMessage extends BaseMessage {
  type: 'stream_start'
  streamId: string
}

/**
 * Streaming chunk.
 */
export interface StreamDeltaMessage extends BaseMessage {
  type: 'stream_delta'
  streamId: string
  delta: string
  isThinking?: boolean
}

/**
 * Stream end marker.
 */
export interface StreamEndMessage extends BaseMessage {
  type: 'stream_end'
  streamId: string
  finalContent?: string
}

/**
 * Union type for all messages.
 */
export type ChannelMessage =
  | UserMessage
  | AssistantMessage
  | ToolUseMessage
  | ToolResultMessage
  | ErrorMessage
  | SystemMessage
  | ApprovalRequestMessage
  | ApprovalResponseMessage
  | StreamStartMessage
  | StreamDeltaMessage
  | StreamEndMessage

/**
 * Channel state.
 */
export type ChannelState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Channel events.
 */
export interface ChannelEvents {
  message: (message: ChannelMessage) => void
  stateChange: (state: ChannelState) => void
  error: (error: Error) => void
}

/**
 * Event emitter interface.
 */
export interface ChannelEventEmitter {
  on<K extends keyof ChannelEvents>(event: K, listener: ChannelEvents[K]): void
  off<K extends keyof ChannelEvents>(event: K, listener: ChannelEvents[K]): void
  emit<K extends keyof ChannelEvents>(
    event: K,
    ...args: Parameters<ChannelEvents[K]>
  ): void
}

/**
 * Channel interface for communication.
 */
export interface Channel extends ChannelEventEmitter {
  readonly state: ChannelState
  readonly sessionId: string

  /**
   * Send a message through the channel.
   */
  send(message: ChannelMessage): Promise<void>

  /**
   * Connect the channel.
   */
  connect(): Promise<void>

  /**
   * Disconnect the channel.
   */
  disconnect(): Promise<void>

  /**
   * Wait for a specific message type.
   */
  waitFor<T extends ChannelMessage>(
    type: MessageType,
    timeout?: number
  ): Promise<T>
}
