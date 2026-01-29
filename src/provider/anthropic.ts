import type {
  Provider,
  ConversationMessage,
  ProviderRequestOptions,
  ProviderResponse,
  StreamEvent,
  ContentBlock,
  StopReason,
  TokenUsage,
  ProviderErrorCode,
} from './types.js'
import { ProviderError } from './types.js'

/**
 * Anthropic API configuration.
 */
export interface AnthropicConfig {
  /** API key */
  apiKey: string
  /** Base URL (defaults to https://api.anthropic.com) */
  baseUrl?: string
  /** API version header */
  apiVersion?: string
  /** Default model */
  defaultModel?: string
  /** Request timeout in ms */
  timeout?: number
  /** Max retries */
  maxRetries?: number
}

/**
 * Anthropic API provider.
 */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic'
  private config: Required<AnthropicConfig>

  constructor(config: AnthropicConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://api.anthropic.com',
      apiVersion: config.apiVersion ?? '2023-06-01',
      defaultModel: config.defaultModel ?? 'claude-sonnet-4-20250514',
      timeout: config.timeout ?? 120000,
      maxRetries: config.maxRetries ?? 3,
    }
  }

  /**
   * Check if provider is available.
   */
  isAvailable(): boolean {
    return !!this.config.apiKey
  }

  /**
   * Count tokens (rough approximation).
   */
  countTokens(text: string): number {
    // Rough approximation: ~4 chars per token for English
    return Math.ceil(text.length / 4)
  }

  /**
   * Create a message (non-streaming).
   */
  async createMessage(
    messages: ConversationMessage[],
    options: ProviderRequestOptions
  ): Promise<ProviderResponse> {
    const body = this.buildRequestBody(messages, options)

    const response = await this.fetchWithRetry('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const data = await response.json()
    return this.parseResponse(data)
  }

  /**
   * Create a streaming message.
   */
  async *createMessageStream(
    messages: ConversationMessage[],
    options: ProviderRequestOptions
  ): AsyncIterable<StreamEvent> {
    const body = this.buildRequestBody(messages, options)
    body.stream = true

    const response = await this.fetchWithRetry('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    if (!response.body) {
      throw new ProviderError('No response body', 'api_error')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue

            try {
              const event = JSON.parse(data)
              yield this.parseStreamEvent(event)
            } catch {
              // Ignore parse errors for incomplete data
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Build request body for Anthropic API.
   */
  private buildRequestBody(
    messages: ConversationMessage[],
    options: ProviderRequestOptions
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model ?? this.config.defaultModel,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options.maxTokens ?? 4096,
    }

    if (options.system) {
      body.system = options.system
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    if (options.stopSequences?.length) {
      body.stop_sequences = options.stopSequences
    }

    if (options.tools?.length) {
      body.tools = options.tools
    }

    if (options.metadata) {
      body.metadata = options.metadata
    }

    return body
  }

  /**
   * Parse API response.
   */
  private parseResponse(data: any): ProviderResponse {
    const content: ContentBlock[] = (data.content ?? []).map((block: any) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text }
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        }
      }
      if (block.type === 'thinking') {
        return { type: 'thinking', thinking: block.thinking }
      }
      return block
    })

    const usage: TokenUsage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    }

    if (data.usage?.cache_read_input_tokens) {
      usage.cacheReadTokens = data.usage.cache_read_input_tokens
    }
    if (data.usage?.cache_creation_input_tokens) {
      usage.cacheCreatedTokens = data.usage.cache_creation_input_tokens
    }

    return {
      id: data.id,
      model: data.model,
      content,
      stopReason: this.parseStopReason(data.stop_reason),
      usage,
      raw: data,
    }
  }

  /**
   * Parse stop reason.
   */
  private parseStopReason(reason: string | undefined): StopReason {
    switch (reason) {
      case 'end_turn':
        return 'end_turn'
      case 'max_tokens':
        return 'max_tokens'
      case 'stop_sequence':
        return 'stop_sequence'
      case 'tool_use':
        return 'tool_use'
      default:
        return 'end_turn'
    }
  }

  /**
   * Parse streaming event.
   */
  private parseStreamEvent(event: any): StreamEvent {
    switch (event.type) {
      case 'message_start':
        return {
          type: 'message_start',
          message: {
            id: event.message?.id,
            model: event.message?.model,
            usage: event.message?.usage
              ? {
                  inputTokens: event.message.usage.input_tokens,
                  outputTokens: 0,
                }
              : undefined,
          },
        }

      case 'content_block_start':
        return {
          type: 'content_block_start',
          index: event.index,
          contentBlock: event.content_block,
        }

      case 'content_block_delta':
        return {
          type: 'content_block_delta',
          index: event.index,
          delta: event.delta,
        }

      case 'content_block_stop':
        return {
          type: 'content_block_stop',
          index: event.index,
        }

      case 'message_delta':
        return {
          type: 'message_delta',
          delta: event.delta
            ? { stop_reason: event.delta.stop_reason }
            : undefined,
          // Capture usage from message_delta (output tokens reported at end of stream)
          usage: event.usage
            ? {
                outputTokens: event.usage.output_tokens ?? 0,
              }
            : undefined,
        }

      case 'message_stop':
        return { type: 'message_stop' }

      case 'error':
        return {
          type: 'error',
          error: {
            type: event.error?.type ?? 'unknown',
            message: event.error?.message ?? 'Unknown error',
          },
        }

      default:
        return event
    }
  }

  /**
   * Fetch with retry logic.
   */
  private async fetchWithRetry(
    path: string,
    options: RequestInit,
    retries = 0
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': this.config.apiVersion,
    }

    // Add beta headers for extended features
    headers['anthropic-beta'] = 'max-tokens-3-5-sonnet-2024-07-15'

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...(options.headers as Record<string, string>) },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Handle errors
      if (!response.ok) {
        const error = await this.parseError(response)

        // Retry on retryable errors
        if (error.retryable && retries < this.config.maxRetries) {
          const delay = error.retryAfter
            ? error.retryAfter * 1000
            : Math.pow(2, retries) * 1000

          await new Promise((resolve) => setTimeout(resolve, delay))
          return this.fetchWithRetry(path, options, retries + 1)
        }

        throw error
      }

      return response
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof ProviderError) {
        throw error
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ProviderError(
            `Request timed out after ${this.config.timeout}ms`,
            'timeout_error',
            true
          )
        }

        // Network errors are retryable
        if (retries < this.config.maxRetries) {
          const delay = Math.pow(2, retries) * 1000
          await new Promise((resolve) => setTimeout(resolve, delay))
          return this.fetchWithRetry(path, options, retries + 1)
        }

        throw new ProviderError(
          error.message,
          'network_error',
          false,
          undefined,
          error
        )
      }

      throw new ProviderError('Unknown error', 'unknown_error')
    }
  }

  /**
   * Parse error response.
   */
  private async parseError(response: Response): Promise<ProviderError> {
    let data: any
    try {
      data = await response.json()
    } catch {
      data = { error: { message: response.statusText } }
    }

    const errorType = data.error?.type ?? 'api_error'
    const message = data.error?.message ?? `HTTP ${response.status}`

    let code: ProviderErrorCode = 'api_error'
    let retryable = false
    let retryAfter: number | undefined

    switch (response.status) {
      case 401:
        code = 'authentication_error'
        break
      case 429:
        code = 'rate_limit_error'
        retryable = true
        const retryHeader = response.headers.get('retry-after')
        retryAfter = retryHeader ? parseInt(retryHeader, 10) : 60
        break
      case 529:
        code = 'overloaded_error'
        retryable = true
        retryAfter = 30
        break
      case 400:
        if (errorType === 'invalid_request_error') {
          code = 'invalid_request_error'
          // Check for context length errors
          if (message.includes('context') || message.includes('token')) {
            code = 'context_length_exceeded'
          }
        }
        break
      case 500:
      case 502:
      case 503:
      case 504:
        code = 'api_error'
        retryable = true
        break
    }

    return new ProviderError(message, code, retryable, retryAfter)
  }
}

/**
 * Create an Anthropic provider from environment.
 */
export function createAnthropicProvider(
  config?: Partial<AnthropicConfig>
): AnthropicProvider {
  const apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('Anthropic API key required (set ANTHROPIC_API_KEY or pass apiKey)')
  }

  return new AnthropicProvider({
    ...config,
    apiKey,
  })
}
