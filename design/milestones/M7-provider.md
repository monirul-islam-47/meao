# Milestone 7: Provider Adapter

**Status:** COMPLETE
**Scope:** MVP (MockProvider + Anthropic). OpenAI/Ollama are Phase 2.
**Dependencies:** M1 (Config)
**PR:** Part of PR8

---

## Goal

Implement AI provider abstraction with tool calling and streaming support. Build MockProvider FIRST to enable testing without real LLM calls.

**Strategy:** MockProvider enables testing the orchestrator and tools without LLM costs or latency. Add Anthropic once the rest works.

---

## File Structure

```
src/provider/
├── index.ts                   # Public exports
├── types.ts                   # ProviderClient, ChatRequest, ChatResponse
├── adapter.ts                 # Provider factory
├── mock.ts                    # MockProvider for testing (MVP first!)
├── anthropic.ts               # Anthropic implementation (MVP)
├── openai.ts                  # OpenAI (Phase 2)
├── ollama.ts                  # Ollama (Phase 2)
├── streaming.ts               # Stream handling utilities
└── tools.ts                   # Tool definition formatting
```

---

## Key Exports

```typescript
// src/provider/index.ts
export { createProvider, type ProviderClient } from './adapter'
export { MockProvider } from './mock'
export { type ChatRequest, type ChatResponse, type ToolCall, type StreamEvent } from './types'
```

---

## Implementation Requirements

### 1. Types (types.ts)

```typescript
export interface ProviderClient {
  sendMessage(request: ChatRequest): Promise<ChatResponse>
  streamMessage(request: ChatRequest): AsyncIterable<StreamEvent>
}

export interface ChatRequest {
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
}

export interface Message {
  role: 'user' | 'assistant' | 'tool_result'
  content: string
  toolCallId?: string  // For tool_result
}

export interface ChatResponse {
  content: string
  toolCalls?: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
}

// Streaming events
export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; delta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'complete'; response: ChatResponse }

// NOTE: tool_call_delta streams JSON argument chunks
// Orchestrator must buffer these and parse on tool_call_end
```

### 2. MockProvider (mock.ts) - BUILD FIRST

```typescript
import { randomUUID } from 'crypto'
import {
  ProviderClient,
  ChatRequest,
  ChatResponse,
  StreamEvent,
  ToolCall,
} from './types'

interface MockScenario {
  trigger: string | RegExp
  toolCalls?: ToolCall[]
  response?: string
  afterToolResult?: string
}

export class MockProvider implements ProviderClient {
  private scenarios: MockScenario[] = []
  private awaitingToolResult = false
  private pendingResponse: string | null = null

  addScenario(scenario: MockScenario): void {
    this.scenarios.push(scenario)
  }

  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    const events: StreamEvent[] = []
    for await (const event of this.streamMessage(request)) {
      events.push(event)
    }

    const complete = events.find(e => e.type === 'complete')
    if (complete?.type === 'complete') {
      return complete.response
    }

    throw new Error('No complete event')
  }

  async *streamMessage(request: ChatRequest): AsyncIterable<StreamEvent> {
    const lastMessage = request.messages[request.messages.length - 1]

    // Check if this is a tool result
    if (lastMessage.role === 'tool_result' && this.pendingResponse) {
      // Stream the pending response
      for (const char of this.pendingResponse) {
        yield { type: 'text_delta', delta: char }
        await sleep(5)  // Simulate streaming
      }

      yield {
        type: 'complete',
        response: {
          content: this.pendingResponse,
          usage: { inputTokens: 100, outputTokens: this.pendingResponse.length },
          stopReason: 'end_turn',
        },
      }

      this.pendingResponse = null
      return
    }

    // Find matching scenario
    const content = lastMessage.content
    const scenario = this.scenarios.find(s => {
      if (typeof s.trigger === 'string') {
        return content.toLowerCase().includes(s.trigger.toLowerCase())
      }
      return s.trigger.test(content)
    })

    if (scenario?.toolCalls) {
      // Stream tool calls
      for (const toolCall of scenario.toolCalls) {
        yield { type: 'tool_call_start', id: toolCall.id, name: toolCall.name }

        const argsJson = JSON.stringify(toolCall.arguments)
        for (const char of argsJson) {
          yield { type: 'tool_call_delta', id: toolCall.id, delta: char }
          await sleep(2)
        }

        yield { type: 'tool_call_end', id: toolCall.id }
      }

      this.pendingResponse = scenario.afterToolResult ?? 'Done.'

      yield {
        type: 'complete',
        response: {
          content: '',
          toolCalls: scenario.toolCalls,
          usage: { inputTokens: 100, outputTokens: 0 },
          stopReason: 'tool_use',
        },
      }
      return
    }

    // Default: echo or use scenario response
    const response = scenario?.response ?? `Echo: ${content}`

    for (const char of response) {
      yield { type: 'text_delta', delta: char }
      await sleep(5)
    }

    yield {
      type: 'complete',
      response: {
        content: response,
        usage: { inputTokens: content.length, outputTokens: response.length },
        stopReason: 'end_turn',
      },
    }
  }

  // Pre-configured for golden path testing
  static goldenPath(): MockProvider {
    const provider = new MockProvider()

    provider.addScenario({
      trigger: 'npm',
      toolCalls: [{
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'web_fetch',
        arguments: {
          url: 'https://www.npmjs.com/package/lodash',
          method: 'GET',
        },
      }],
      afterToolResult: 'Based on the npm page, lodash is a utility library that provides helpful functions for working with arrays, objects, and strings.',
    })

    provider.addScenario({
      trigger: /list.*files|show.*directory/i,
      toolCalls: [{
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'bash',
        arguments: { command: 'ls -la' },
      }],
      afterToolResult: 'Here are the files in the current directory.',
    })

    return provider
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

### 3. Anthropic Provider (anthropic.ts)

```typescript
import Anthropic from '@anthropic-ai/sdk'
import {
  ProviderClient,
  ChatRequest,
  ChatResponse,
  StreamEvent,
  ToolDefinition,
} from './types'
import { resolveCredential } from '../config'

interface AnthropicConfig {
  model: string
  maxTokens: number
  apiKeyRef: string
  baseUrl?: string
}

export class AnthropicProvider implements ProviderClient {
  private client: Anthropic
  private config: AnthropicConfig

  constructor(config: AnthropicConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    const apiKey = await resolveCredential(this.config.apiKeyRef)
    this.client = new Anthropic({
      apiKey,
      baseURL: this.config.baseUrl,
    })
  }

  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      messages: this.formatMessages(request.messages),
      tools: request.tools ? this.formatTools(request.tools) : undefined,
    })

    return this.parseResponse(response)
  }

  async *streamMessage(request: ChatRequest): AsyncIterable<StreamEvent> {
    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      messages: this.formatMessages(request.messages),
      tools: request.tools ? this.formatTools(request.tools) : undefined,
    })

    for await (const event of stream) {
      const parsed = this.parseStreamEvent(event)
      if (parsed) yield parsed
    }
  }

  private formatMessages(messages: ChatRequest['messages']): Anthropic.MessageParam[] {
    return messages.map(msg => {
      if (msg.role === 'tool_result') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId!,
            content: msg.content,
          }],
        }
      }
      return { role: msg.role, content: msg.content }
    })
  }

  private formatTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }

  private parseResponse(response: Anthropic.Message): ChatResponse {
    const content = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('')

    const toolCalls = response.content
      .filter(c => c.type === 'tool_use')
      .map(c => ({
        id: c.id,
        name: c.name,
        arguments: c.input as Record<string, unknown>,
      }))

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
    }
  }

  private parseStreamEvent(event: unknown): StreamEvent | null {
    // Parse Anthropic stream events to our format
    // Implementation depends on SDK version
    return null
  }
}
```

### 4. Provider Factory (adapter.ts)

```typescript
import { ProviderClient } from './types'
import { MockProvider } from './mock'
import { AnthropicProvider } from './anthropic'
import { AppConfig } from '../config'

export async function createProvider(config: AppConfig): Promise<ProviderClient> {
  const providerConfig = config.providers.primary

  switch (providerConfig.type) {
    case 'anthropic': {
      const provider = new AnthropicProvider({
        model: providerConfig.model,
        maxTokens: providerConfig.maxTokens ?? 4096,
        apiKeyRef: providerConfig.apiKeyRef!,
        baseUrl: providerConfig.baseUrl,
      })
      await provider.initialize()
      return provider
    }

    case 'mock':
      return MockProvider.goldenPath()

    default:
      throw new Error(`Unknown provider type: ${providerConfig.type}`)
  }
}
```

---

## Tests

```
test/provider/
├── mock.test.ts               # MockProvider scenarios
├── anthropic.test.ts          # Anthropic (with mocked SDK)
├── streaming.test.ts          # Stream handling
└── tools.test.ts              # Tool formatting
```

### Critical Test Cases

```typescript
// test/provider/mock.test.ts
describe('MockProvider', () => {
  it('streams text deltas', async () => {
    const provider = new MockProvider()
    const events: StreamEvent[] = []

    for await (const event of provider.streamMessage({
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event)
    }

    const textDeltas = events.filter(e => e.type === 'text_delta')
    expect(textDeltas.length).toBeGreaterThan(0)
  })

  it('goldenPath triggers web_fetch for npm query', async () => {
    const provider = MockProvider.goldenPath()
    const events: StreamEvent[] = []

    for await (const event of provider.streamMessage({
      messages: [{ role: 'user', content: 'Fetch the npm docs for lodash' }],
    })) {
      events.push(event)
    }

    const toolStart = events.find(e => e.type === 'tool_call_start')
    expect(toolStart?.type).toBe('tool_call_start')
    expect((toolStart as any).name).toBe('web_fetch')
  })
})
```

---

## Definition of Done

**MVP (must complete):**
- [ ] MockProvider works for golden path testing
- [ ] MockProvider.goldenPath() triggers web_fetch scenario
- [ ] Anthropic provider works with tool calling
- [ ] Streaming emits proper events
- [ ] Tool calls parsed correctly
- [ ] All tests pass
- [ ] `pnpm check` passes

**Phase 2 (defer):**
- [ ] OpenAI provider
- [ ] Ollama provider
- [ ] Provider failover

---

## Dependencies to Add

```bash
pnpm add @anthropic-ai/sdk
```

---

## Next Milestone

After completing M7, proceed to [M8: Orchestrator](./M8-orchestrator.md).

---

*Last updated: 2026-01-29*
