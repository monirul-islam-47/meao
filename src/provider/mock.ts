import { randomUUID } from 'crypto'
import type {
  Provider,
  ConversationMessage,
  ProviderRequestOptions,
  ProviderResponse,
  StreamEvent,
  ContentBlock,
  StopReason,
} from './types.js'

/**
 * Mock response generator function.
 */
export type MockResponseGenerator = (
  messages: ConversationMessage[],
  options: ProviderRequestOptions
) => MockResponse | Promise<MockResponse>

/**
 * Mock stream generator function for custom streaming events.
 */
export type MockStreamGenerator = () => Generator<StreamEvent, void, unknown> | AsyncGenerator<StreamEvent, void, unknown>

/**
 * Mock response structure.
 */
export interface MockResponse {
  content: ContentBlock[]
  stopReason?: StopReason
  delay?: number
}

/**
 * Mock provider configuration.
 */
export interface MockProviderConfig {
  /** Default response if no generator matches */
  defaultResponse?: MockResponse
  /** Custom response generators */
  responseGenerators?: MockResponseGenerator[]
  /** Custom stream generators for fine-grained streaming control */
  streamGenerators?: MockStreamGenerator[]
  /** Simulate streaming delay between chunks (ms) */
  streamChunkDelay?: number
  /** Approximate tokens per character */
  tokensPerChar?: number
  /** Simulate rate limiting */
  rateLimit?: {
    requestsPerMinute: number
    currentRequests?: number
  }
}

/**
 * Mock provider for testing.
 */
export class MockProvider implements Provider {
  readonly name = 'mock'
  private config: Required<MockProviderConfig>
  private requestCount = 0
  private lastRequestTime = 0
  private streamGeneratorQueue: MockStreamGenerator[] = []

  constructor(config: MockProviderConfig = {}) {
    this.config = {
      defaultResponse: config.defaultResponse ?? {
        content: [{ type: 'text', text: 'This is a mock response.' }],
        stopReason: 'end_turn',
      },
      responseGenerators: config.responseGenerators ?? [],
      streamGenerators: config.streamGenerators ?? [],
      streamChunkDelay: config.streamChunkDelay ?? 50,
      tokensPerChar: config.tokensPerChar ?? 0.25,
      rateLimit: config.rateLimit ?? { requestsPerMinute: 60, currentRequests: 0 },
    }
    this.streamGeneratorQueue = [...this.config.streamGenerators]
  }

  /**
   * Check if provider is available.
   */
  isAvailable(): boolean {
    return true
  }

  /**
   * Count tokens (approximate).
   */
  countTokens(text: string): number {
    return Math.ceil(text.length * this.config.tokensPerChar)
  }

  /**
   * Create a message (non-streaming).
   */
  async createMessage(
    messages: ConversationMessage[],
    options: ProviderRequestOptions
  ): Promise<ProviderResponse> {
    this.checkRateLimit()

    // Try custom generators
    for (const generator of this.config.responseGenerators) {
      const response = await generator(messages, options)
      if (response) {
        if (response.delay) {
          await this.delay(response.delay)
        }
        return this.buildResponse(response, options)
      }
    }

    // Use default response
    if (this.config.defaultResponse.delay) {
      await this.delay(this.config.defaultResponse.delay)
    }

    return this.buildResponse(this.config.defaultResponse, options)
  }

  /**
   * Create a streaming message.
   */
  async *createMessageStream(
    messages: ConversationMessage[],
    options: ProviderRequestOptions
  ): AsyncIterable<StreamEvent> {
    this.checkRateLimit()

    // Check for custom stream generators first (FIFO queue)
    if (this.streamGeneratorQueue.length > 0) {
      const streamGen = this.streamGeneratorQueue.shift()!
      const generator = streamGen()
      for await (const event of generator) {
        yield event
      }
      return
    }

    // Get the response from regular generators
    let response: MockResponse = this.config.defaultResponse
    for (const generator of this.config.responseGenerators) {
      const generated = await generator(messages, options)
      if (generated) {
        response = generated
        break
      }
    }

    const fullResponse = this.buildResponse(response, options)

    // Emit message_start
    yield {
      type: 'message_start',
      message: {
        id: fullResponse.id,
        model: fullResponse.model,
        usage: { inputTokens: fullResponse.usage.inputTokens, outputTokens: 0 },
      },
    }

    // Stream each content block
    for (let i = 0; i < response.content.length; i++) {
      const block = response.content[i]

      // Emit content_block_start
      yield {
        type: 'content_block_start',
        index: i,
        contentBlock: block,
      }

      // For text blocks, stream the content character by character (in chunks)
      if (block.type === 'text') {
        const chunks = this.chunkText(block.text, 20)
        for (const chunk of chunks) {
          await this.delay(this.config.streamChunkDelay)
          yield {
            type: 'content_block_delta',
            index: i,
            delta: { type: 'text', text: chunk },
          }
        }
      }

      // Emit content_block_stop
      yield {
        type: 'content_block_stop',
        index: i,
      }
    }

    // Emit message_delta with stop reason
    yield {
      type: 'message_delta',
      delta: { stop_reason: fullResponse.stopReason },
    }

    // Emit message_stop
    yield {
      type: 'message_stop',
    }
  }

  /**
   * Add a response generator.
   */
  addGenerator(generator: MockResponseGenerator): void {
    this.config.responseGenerators.push(generator)
  }

  /**
   * Add a stream generator for custom streaming events.
   * Stream generators are consumed in FIFO order.
   */
  addStreamGenerator(generator: MockStreamGenerator): void {
    this.streamGeneratorQueue.push(generator)
  }

  /**
   * Set the default response.
   */
  setDefaultResponse(response: MockResponse): void {
    this.config.defaultResponse = response
  }

  /**
   * Reset the provider state.
   */
  reset(): void {
    this.requestCount = 0
    this.lastRequestTime = 0
    this.config.responseGenerators = []
    this.streamGeneratorQueue = []
  }

  /**
   * Build a full response from mock response.
   */
  private buildResponse(
    mock: MockResponse,
    options: ProviderRequestOptions
  ): ProviderResponse {
    const contentText = mock.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as any).text)
      .join('')

    return {
      id: `mock-${randomUUID()}`,
      model: options.model,
      content: mock.content,
      stopReason: mock.stopReason ?? 'end_turn',
      usage: {
        inputTokens: this.countTokens(JSON.stringify(options)),
        outputTokens: this.countTokens(contentText),
      },
    }
  }

  /**
   * Check rate limiting.
   */
  private checkRateLimit(): void {
    const now = Date.now()
    const minuteAgo = now - 60000

    if (this.lastRequestTime < minuteAgo) {
      this.requestCount = 0
    }

    this.requestCount++
    this.lastRequestTime = now

    if (this.requestCount > this.config.rateLimit.requestsPerMinute) {
      const { ProviderError } = require('./types.js')
      throw new ProviderError(
        'Rate limit exceeded',
        'rate_limit_error',
        true,
        60
      )
    }
  }

  /**
   * Split text into chunks.
   */
  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize))
    }
    return chunks
  }

  /**
   * Delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create a mock provider with common test scenarios.
 */
export function createMockProvider(config?: MockProviderConfig): MockProvider {
  return new MockProvider(config)
}

/**
 * Create a mock response generator that matches on user message content.
 */
export function matchUserMessage(
  pattern: string | RegExp,
  response: MockResponse
): MockResponseGenerator {
  return (messages) => {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user')

    if (!lastUserMessage) return response

    const content =
      typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : lastUserMessage.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as any).text)
            .join('')

    if (typeof pattern === 'string') {
      if (content.includes(pattern)) return response
    } else {
      if (pattern.test(content)) return response
    }

    return { content: [], stopReason: 'end_turn' } as any
  }
}

/**
 * Create a mock response with tool use.
 */
export function createToolUseResponse(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId?: string
): MockResponse {
  return {
    content: [
      {
        type: 'tool_use',
        id: toolId ?? `tool-${randomUUID()}`,
        name: toolName,
        input: toolInput,
      },
    ],
    stopReason: 'tool_use',
  }
}
