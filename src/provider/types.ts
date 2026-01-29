/**
 * Role for conversation messages.
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Content block types.
 */
export type ContentBlockType = 'text' | 'tool_use' | 'tool_result' | 'thinking'

/**
 * Text content block.
 */
export interface TextBlock {
  type: 'text'
  text: string
}

/**
 * Tool use request block.
 */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Tool result block.
 */
export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

/**
 * Thinking block (extended thinking).
 */
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

/**
 * Union of content blocks.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock

/**
 * Conversation message.
 */
export interface ConversationMessage {
  role: MessageRole
  content: string | ContentBlock[]
}

/**
 * Tool definition for the provider.
 */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Provider request options.
 */
export interface ProviderRequestOptions {
  /** Model to use */
  model: string
  /** Maximum tokens in response */
  maxTokens?: number
  /** Temperature (0-1) */
  temperature?: number
  /** Stop sequences */
  stopSequences?: string[]
  /** System prompt */
  system?: string
  /** Tools available */
  tools?: ToolDefinition[]
  /** Metadata for the request */
  metadata?: Record<string, unknown>
}

/**
 * Stop reason for response.
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'

/**
 * Token usage information.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreatedTokens?: number
}

/**
 * Provider response.
 */
export interface ProviderResponse {
  /** Response ID */
  id: string
  /** Model used */
  model: string
  /** Content blocks in response */
  content: ContentBlock[]
  /** Why the response stopped */
  stopReason: StopReason
  /** Token usage */
  usage: TokenUsage
  /** Raw response (for debugging) */
  raw?: unknown
}

/**
 * Streaming event types.
 */
export type StreamEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'error'

/**
 * Stream event for real-time responses.
 */
export interface StreamEvent {
  type: StreamEventType
  index?: number
  delta?: Partial<ContentBlock> | { stop_reason?: StopReason }
  contentBlock?: ContentBlock
  message?: Partial<ProviderResponse>
  error?: { type: string; message: string }
  /** Usage info (reported in message_delta at end of stream) */
  usage?: Partial<TokenUsage>
}

/**
 * Provider interface for LLM backends.
 */
export interface Provider {
  /** Provider name */
  readonly name: string

  /**
   * Send a request to the provider.
   */
  createMessage(
    messages: ConversationMessage[],
    options: ProviderRequestOptions
  ): Promise<ProviderResponse>

  /**
   * Send a streaming request.
   */
  createMessageStream(
    messages: ConversationMessage[],
    options: ProviderRequestOptions
  ): AsyncIterable<StreamEvent>

  /**
   * Count tokens in text (approximate).
   */
  countTokens(text: string): number

  /**
   * Check if provider is available (has credentials, etc).
   */
  isAvailable(): boolean
}

/**
 * Provider error.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly retryable: boolean = false,
    public readonly retryAfter?: number,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * Error codes for provider errors.
 */
export type ProviderErrorCode =
  | 'authentication_error'
  | 'rate_limit_error'
  | 'overloaded_error'
  | 'invalid_request_error'
  | 'api_error'
  | 'network_error'
  | 'timeout_error'
  | 'context_length_exceeded'
  | 'unknown_error'
