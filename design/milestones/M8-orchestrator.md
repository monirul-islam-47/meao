# Milestone 8: Orchestrator

**Status:** COMPLETE
**Scope:** MVP
**Dependencies:** M5 (Tool System), M6 (CLI Channel), M7 (Provider)
**PR:** Part of PR8

---

## Goal

Implement the message routing loop that ties everything together. The orchestrator handles the core flow: message → provider → tools → response.

**Spec Reference:** [ARCHITECTURE.md](../ARCHITECTURE.md) (orchestrator role)

---

## File Structure

```
src/orchestrator/
├── index.ts                   # Public exports
├── types.ts                   # Orchestrator types
├── core.ts                    # Main orchestrator loop
├── context.ts                 # Context builder
├── router.ts                  # Skill/tool routing (minimal first)
└── events.ts                  # Orchestrator events
```

---

## Key Exports

```typescript
// src/orchestrator/index.ts
export { Orchestrator } from './core'
export { buildContext, type RequestContext } from './context'
export { type OrchestratorEvent, type OrchestratorConfig } from './types'
```

---

## Implementation Requirements

### 1. Types (types.ts)

```typescript
export interface OrchestratorConfig {
  provider: ProviderClient
  toolRegistry: ToolRegistry
  toolExecutor: ToolExecutor
  audit: AuditLogger
  sessionManager: SessionManager
}

export interface OrchestratorEvent {
  type: 'message_start' | 'tool_call' | 'tool_result' | 'message_complete' | 'error'
  timestamp: Date
  requestId: string
  data: unknown
}

export interface RequestContext {
  requestId: string
  sessionId: string
  userId: string
  channel: Channel
  workDir: string
  approvals: string[]
  messages: Message[]
  startTime: Date
  sandbox: SandboxExecutor
  audit: AuditLogger
}
```

### 2. Orchestrator Core (core.ts)

**CRITICAL FIX:** Cannot reassign `stream` inside a `for await` loop. Use an outer while loop instead.

```typescript
import { randomUUID } from 'crypto'
import {
  ProviderClient,
  StreamEvent,
  Message,
  ChatResponse,
} from '../provider'
import { Channel, ChannelMessage } from '../channels'
import { ToolRegistry, ToolExecutor } from '../tools'
import { AuditLogger } from '../audit'
import { RequestContext, Session } from './context'
import { zodToJsonSchema } from './schema-utils'

export class Orchestrator {
  private provider: ProviderClient
  private toolRegistry: ToolRegistry
  private toolExecutor: ToolExecutor
  private audit: AuditLogger
  private sessionManager: SessionManager

  constructor(config: OrchestratorConfig) {
    this.provider = config.provider
    this.toolRegistry = config.toolRegistry
    this.toolExecutor = config.toolExecutor
    this.audit = config.audit
    this.sessionManager = config.sessionManager
  }

  async handleMessage(
    message: ChannelMessage,
    channel: Channel,
    session: Session
  ): Promise<void> {
    const context = await this.buildContext(message, session)

    // Audit message start
    await this.audit.log('channel', 'message_received', {
      metadata: {
        requestId: context.requestId,
        sessionId: context.sessionId,
        userId: context.userId,
        channel: channel.name,
        // NOTE: message.content NOT logged (NEVER_LOG)
      },
    })

    try {
      // Track tool results for history (accumulated across restarts)
      const executedToolResults: Message[] = []

      // OUTER LOOP: Restart stream after tool execution
      // Cannot reassign stream inside for-await, so we use while(true) + break
      while (true) {
        // Buffer for streaming tool call arguments
        const toolCallBuffers = new Map<string, { name: string; chunks: string[] }>()
        let needsRestart = false
        let finalResponse: ChatResponse | null = null

        // Create new stream for this iteration
        const stream = this.provider.streamMessage({
          messages: context.messages,
          tools: this.getAvailableToolDefinitions(),
        })

        // INNER LOOP: Consume current stream
        for await (const event of stream) {
          switch (event.type) {
            case 'text_delta':
              channel.streamDelta(event.delta)
              // NOTE: Don't accumulate here - use finalResponse.content for history
              break

            case 'tool_call_start':
              toolCallBuffers.set(event.id, { name: event.name, chunks: [] })
              channel.onToolCallStart?.(event.name)
              break

            case 'tool_call_delta':
              const buffer = toolCallBuffers.get(event.id)
              if (buffer) {
                buffer.chunks.push(event.delta)
              }
              break

            case 'tool_call_end':
              const callBuffer = toolCallBuffers.get(event.id)
              if (!callBuffer) {
                throw new Error(`Unknown tool call: ${event.id}`)
              }

              // Parse accumulated JSON
              const argsJson = callBuffer.chunks.join('')
              let args: Record<string, unknown>
              try {
                args = JSON.parse(argsJson)
              } catch (parseError) {
                throw new Error(`Failed to parse tool arguments: ${parseError}`)
              }

              // Get tool and execute
              const tool = this.toolRegistry.get(callBuffer.name)
              if (!tool) {
                throw new Error(`Unknown tool: ${callBuffer.name}`)
              }

              const result = await this.toolExecutor.execute(tool, args, context)
              channel.onToolCallResult?.(callBuffer.name, result.success)

              // Create tool result message
              const toolResultMessage: Message = {
                role: 'tool_result',
                toolCallId: event.id,
                content: result.output,
              }

              // Add to context for provider continuation
              context.messages.push(toolResultMessage)

              // Track for session history
              executedToolResults.push(toolResultMessage)

              toolCallBuffers.delete(event.id)
              needsRestart = true

              // CRITICAL: Break inner loop immediately after tool execution
              // Provider hasn't seen the tool result yet - must restart stream
              break
          }

          // Exit inner loop if we need to restart
          if (needsRestart) break
        }

        // If tool was executed, loop again to get continuation
        if (needsRestart) {
          continue
        }

        // No more tool calls - we're done
        if (finalResponse) {
          channel.streamComplete()

          // UPDATE SESSION HISTORY (critical fix)
          // 1. Add user message
          this.sessionManager.addToHistory(session.id, {
            role: 'user',
            content: message.content,
          })

          // 2. Add tool result messages (if any)
          for (const toolResult of executedToolResults) {
            this.sessionManager.addToHistory(session.id, toolResult)
          }

          // 3. Add assistant response (use finalResponse.content, not streamed deltas)
          // This avoids double-counting if stream restarts re-emit content
          if (finalResponse.content) {
            this.sessionManager.addToHistory(session.id, {
              role: 'assistant',
              content: finalResponse.content,
            })
          }

          await this.auditCompletion(context, finalResponse)
        }

        break  // Exit outer loop
      }

    } catch (error) {
      await this.audit.log('channel', 'message_error', {
        severity: 'warning',
        metadata: {
          requestId: context.requestId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  private async buildContext(
    message: ChannelMessage,
    session: Session
  ): Promise<RequestContext> {
    return {
      requestId: randomUUID(),
      sessionId: session.id,
      userId: message.userId,
      channel: session.channel,
      workDir: session.workDir,
      approvals: [],
      messages: [
        ...session.history,  // Working memory (already persisted)
        { role: 'user', content: message.content },
      ],
      startTime: new Date(),
      sandbox: session.sandbox,
      audit: this.audit,
    }
  }

  // Convert Zod schemas to JSON Schema for provider
  private getAvailableToolDefinitions(): ToolDefinition[] {
    return this.toolRegistry.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      // CRITICAL: Provider expects JSON Schema, not Zod schema
      parameters: zodToJsonSchema(tool.parameters),
    }))
  }

  private async auditCompletion(
    context: RequestContext,
    response: ChatResponse
  ): Promise<void> {
    await this.audit.log('channel', 'message_complete', {
      metadata: {
        requestId: context.requestId,
        sessionId: context.sessionId,
        duration: Date.now() - context.startTime.getTime(),
        usage: response.usage,
        stopReason: response.stopReason,
        // NOTE: response.content NOT logged (NEVER_LOG)
      },
    })
  }
}
```

### 3. Zod to JSON Schema Conversion (schema-utils.ts)

**CRITICAL:** Providers expect JSON Schema, but tools define parameters with Zod.

```typescript
import { z } from 'zod'
import type { JsonSchema } from '../provider'

/**
 * Convert a Zod schema to JSON Schema for provider tool definitions.
 *
 * Note: For complex schemas, consider using zod-to-json-schema package.
 * This is a minimal implementation for common cases.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  // If using zod-to-json-schema package:
  // import { zodToJsonSchema as convert } from 'zod-to-json-schema'
  // return convert(schema)

  // Minimal implementation for MVP:
  return zodToJsonSchemaBasic(schema)
}

function zodToJsonSchemaBasic(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def

  // Handle ZodObject
  if (def.typeName === 'ZodObject') {
    const shape = def.shape()
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchemaBasic(value as z.ZodTypeAny)

      // Check if field is required (not optional)
      if (!(value as z.ZodTypeAny).isOptional()) {
        required.push(key)
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    }
  }

  // Handle ZodString
  if (def.typeName === 'ZodString') {
    return { type: 'string' }
  }

  // Handle ZodNumber
  if (def.typeName === 'ZodNumber') {
    return { type: 'number' }
  }

  // Handle ZodBoolean
  if (def.typeName === 'ZodBoolean') {
    return { type: 'boolean' }
  }

  // Handle ZodArray
  if (def.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodToJsonSchemaBasic(def.type),
    }
  }

  // Handle ZodEnum
  if (def.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: def.values,
    }
  }

  // Handle ZodOptional
  if (def.typeName === 'ZodOptional') {
    return zodToJsonSchemaBasic(def.innerType)
  }

  // Handle ZodDefault
  if (def.typeName === 'ZodDefault') {
    const inner = zodToJsonSchemaBasic(def.innerType)
    return { ...inner, default: def.defaultValue() }
  }

  // Fallback
  return {}
}
```

**Alternative:** Use the `zod-to-json-schema` package for full coverage:

```bash
pnpm add zod-to-json-schema
```

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema'

export function convertSchema(schema: z.ZodTypeAny): JsonSchema {
  return zodToJsonSchema(schema, { target: 'openApi3' })
}
```

### 4. Context Builder (context.ts)

```typescript
import { randomUUID } from 'crypto'
import { ChannelMessage, Channel } from '../channels'
import { SandboxExecutor } from '../sandbox'
import { AuditLogger } from '../audit'
import { Message } from '../provider'

export interface RequestContext {
  requestId: string
  sessionId: string
  userId: string
  channel: Channel
  workDir: string
  approvals: string[]
  messages: Message[]
  startTime: Date
  sandbox: SandboxExecutor
  audit: AuditLogger
}

export interface Session {
  id: string
  channel: Channel
  workDir: string
  history: Message[]  // Persisted by SessionManager
  sandbox: SandboxExecutor
}
```

### 5. Session Management

**CRITICAL:** Session history must be updated after message handling completes.

```typescript
import { Message } from '../provider'
import { Channel } from '../channels'
import { SandboxExecutor } from '../sandbox'
import { AppConfig } from '../config'

// Simple session management for MVP
// Phase 2: Add persistence, multi-session support

export class SessionManager {
  private sessions = new Map<string, Session>()
  private maxHistoryLength = 50

  async getOrCreateSession(
    userId: string,
    channel: Channel,
    config: AppConfig
  ): Promise<Session> {
    const sessionId = `${channel.name}:${userId}`

    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        channel,
        workDir: config.workDir,
        history: [],
        sandbox: new SandboxExecutor(),
      }
      this.sessions.set(sessionId, session)
    }

    return session
  }

  /**
   * Add a message to session history.
   * Called by orchestrator AFTER message handling completes.
   *
   * Messages to add:
   * - User message
   * - Tool result messages (if any)
   * - Assistant final response
   */
  addToHistory(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      console.warn(`Session not found: ${sessionId}`)
      return
    }

    session.history.push(message)

    // Trim to max history length, keeping most recent
    if (session.history.length > this.maxHistoryLength) {
      session.history = session.history.slice(-this.maxHistoryLength)
    }
  }

  /**
   * Add multiple messages at once (e.g., tool results + assistant response)
   */
  addMultipleToHistory(sessionId: string, messages: Message[]): void {
    for (const message of messages) {
      this.addToHistory(sessionId, message)
    }
  }

  /**
   * Get session by ID (for testing)
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Clear session history (for /clear command)
   */
  clearHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.history = []
    }
  }
}
```

---

## Tests

```
test/orchestrator/
├── core.test.ts               # Orchestrator loop
├── context.test.ts            # Context building
├── session.test.ts            # Session management
└── golden_path.test.ts        # End-to-end integration
```

### Critical Test Cases

```typescript
// test/orchestrator/core.test.ts
describe('Orchestrator', () => {
  it('streams text deltas to channel', async () => {
    const provider = new MockProvider()
    provider.addScenario('hello', { response: 'Hello there!' })

    const orchestrator = createTestOrchestrator({ provider })
    const channel = createMockChannel()

    await orchestrator.handleMessage(
      { id: '1', userId: 'user-1', content: 'hello', timestamp: new Date() },
      channel,
      createTestSession()
    )

    expect(channel.streamedDeltas.length).toBeGreaterThan(0)
    expect(channel.streamComplete).toHaveBeenCalled()
  })

  it('buffers tool call deltas and parses on end', async () => {
    const provider = MockProvider.goldenPath()
    const orchestrator = createTestOrchestrator({ provider })
    const channel = createMockChannel()

    await orchestrator.handleMessage(
      { id: '1', userId: 'user-1', content: 'Fetch npm docs', timestamp: new Date() },
      channel,
      createTestSession()
    )

    // Tool call should have been executed
    expect(channel.onToolCallStart).toHaveBeenCalledWith('web_fetch')
    expect(channel.onToolCallResult).toHaveBeenCalledWith('web_fetch', true)
  })

  it('updates session history after completion (including tool results)', async () => {
    const provider = MockProvider.goldenPath()
    const sessionManager = new SessionManager()
    const orchestrator = createTestOrchestrator({ provider, sessionManager })
    const channel = createMockChannel()
    const session = await sessionManager.getOrCreateSession('user-1', channel, testConfig)

    // History starts empty
    expect(session.history.length).toBe(0)

    await orchestrator.handleMessage(
      { id: '1', userId: 'user-1', content: 'Fetch npm docs', timestamp: new Date() },
      channel,
      session
    )

    // After completion with tool call, history should have:
    // 1. User message
    // 2. Tool result message(s)
    // 3. Assistant final response
    expect(session.history.length).toBeGreaterThanOrEqual(3)

    // First message is user
    expect(session.history[0].role).toBe('user')
    expect(session.history[0].content).toBe('Fetch npm docs')

    // Middle message(s) are tool results
    expect(session.history[1].role).toBe('tool_result')
    expect(session.history[1].toolCallId).toBeTruthy()

    // Last message is assistant (from finalResponse.content, not streamed deltas)
    const lastMessage = session.history[session.history.length - 1]
    expect(lastMessage.role).toBe('assistant')
  })
})

// test/orchestrator/golden_path.test.ts
describe('Golden Path', () => {
  it('handles web_fetch tool call end-to-end', async () => {
    // Use MockProvider for deterministic testing
    const provider = MockProvider.goldenPath()
    const orchestrator = createTestOrchestrator({ provider })
    const channel = createMockChannel()

    // Use real owner UUID (created on test setup)
    const ownerId = await getTestOwnerId()

    await orchestrator.handleMessage({
      id: '1',
      userId: ownerId,  // Real UUID, not 'owner' string
      content: 'Fetch the npm page for lodash',
      timestamp: new Date(),
    }, channel, createTestSession())

    // Verify tool was called
    expect(channel.toolCalls).toContainEqual({
      name: 'web_fetch',
      approved: true,  // Auto-approved (GET to known host)
    })

    // Verify audit entry exists WITHOUT content
    const auditEntries = await getAuditEntries()
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        category: 'tool',
        action: 'tool_executed',
        metadata: expect.objectContaining({
          tool: 'web_fetch',
          // CRITICAL: no 'output' field (NEVER_LOG enforced)
        }),
      })
    )
    // Verify output was NOT logged
    expect(auditEntries.every(e => !e.metadata?.tool?.output)).toBe(true)

    // Verify response was streamed
    expect(channel.streamedContent).toBeTruthy()
  })

  it('handles approval rejection gracefully', async () => {
    const provider = MockProvider.goldenPath()
    const orchestrator = createTestOrchestrator({ provider })
    const channel = createMockChannel()

    // Mock approval to return false
    channel.requestApproval = vi.fn().mockResolvedValue(false)

    // Set up scenario that requires approval
    provider.addScenario('delete', {
      toolCalls: [{
        id: 'call_1',
        name: 'bash',
        arguments: { command: 'rm -rf /tmp/test' },
      }],
    })

    await orchestrator.handleMessage({
      id: '1',
      userId: 'user-1',
      content: 'delete the files',
      timestamp: new Date(),
    }, channel, createTestSession())

    // Verify denial was audited
    const auditEntries = await getAuditEntries()
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        category: 'tool',
        action: 'tool_denied',
      })
    )
  })
})
```

---

## Definition of Done

- [ ] Orchestrator handles message → provider → tools → response flow
- [ ] **Stream restart works correctly** (outer while loop, not reassignment)
- [ ] Tool call argument buffering works (buffer deltas, parse on end)
- [ ] Tool calls executed through ToolExecutor
- [ ] **Zod schemas converted to JSON Schema** for provider
- [ ] Streaming works end-to-end via channel hooks
- [ ] Context properly built with working memory
- [ ] **Session history updated after completion** (user msg + assistant msg)
- [ ] Session history trimmed to max length (50)
- [ ] Audit events emitted throughout (without content)
- [ ] Golden path test passes
- [ ] All tests pass
- [ ] `pnpm check` passes

---

## Key Architecture Decisions

### Stream Restart Pattern (Critical)

**Problem:** You cannot reassign an async iterator variable inside a `for await` loop.

```typescript
// WRONG - This doesn't work!
for await (const event of stream) {
  if (needsRestart) {
    stream = provider.streamMessage(...)  // Won't restart the loop
  }
}
```

**Solution:** Use an outer `while(true)` loop with `break`/`continue`, and **break immediately after tool execution**:

```typescript
// CORRECT - Outer loop restarts stream, inner loop breaks on tool execution
while (true) {
  const stream = provider.streamMessage(...)
  let needsRestart = false

  for await (const event of stream) {
    if (event.type === 'tool_call_end') {
      // Execute tool, add result to messages...
      needsRestart = true
      break  // CRITICAL: Stop consuming this stream immediately
             // Provider hasn't seen tool result yet - must restart
    }
  }

  if (needsRestart) continue  // Start new stream with tool result
  break  // Done
}
```

**Why break immediately?** After a tool executes, the provider needs to see the tool result before generating more output. Continuing to consume the old stream can lead to inconsistent sequences.

### Tool Call Buffering

The provider streams tool call arguments as JSON chunks via `tool_call_delta` events. The orchestrator:

1. Creates a buffer on `tool_call_start`
2. Accumulates chunks on `tool_call_delta`
3. Parses JSON and executes on `tool_call_end`

This matches how the Anthropic API streams tool calls.

### Zod to JSON Schema Conversion

**Problem:** Tools define parameters with Zod, but providers expect JSON Schema.

**Solution:** Centralize conversion in `schema-utils.ts`:

```typescript
// In getAvailableToolDefinitions()
parameters: zodToJsonSchema(tool.parameters)  // Not tool.parameters directly
```

Options:
1. Use `zod-to-json-schema` package (recommended)
2. Minimal hand-rolled converter for MVP

### Session History Updates

**Critical:** Session history must be updated AFTER message handling completes.

The orchestrator updates history via `SessionManager.addToHistory()`:
1. **User message** - The original user input
2. **Tool result messages** - All tool executions (accumulated across restarts)
3. **Assistant final response** - From `finalResponse.content`, NOT streamed deltas

**Why use finalResponse.content instead of accumulated deltas?**
- Stream restarts can re-emit content, causing duplication
- `finalResponse.content` is the authoritative complete response
- Avoids race conditions and edge cases

This happens after the outer loop completes, not during streaming.

### Channel Hooks

The Channel interface has optional hooks:
- `onToolCallStart?(name: string, summary?: string)`
- `onToolCallResult?(name: string, success: boolean)`

These enable channels to render tool execution UX (spinners, status icons) without coupling the orchestrator to specific rendering logic.

---

## Dependencies to Add

```bash
# For Zod to JSON Schema conversion
pnpm add zod-to-json-schema
```

---

## Next Milestone

After completing M8, proceed to [M9: Gateway](./M9-gateway.md) (Phase 2).

---

*Last updated: 2026-01-29*
