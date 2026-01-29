# Milestone 9: Gateway (HTTP + WebSocket)

**Status:** NOT STARTED
**Scope:** Phase 2
**Dependencies:** M8 (Orchestrator)
**PR:** PR9

---

## Goal

Implement the HTTP/WebSocket API for non-CLI clients. This enables Telegram, web interfaces, and other integrations to connect to meao.

**Spec Reference:** [API.md](../API.md)

---

## File Structure

```
src/gateway/
├── index.ts                   # Public exports
├── server.ts                  # HTTP server setup
├── routes/
│   ├── index.ts               # Route registration
│   ├── health.ts              # Health check endpoints
│   ├── sessions.ts            # Session management
│   ├── messages.ts            # Message endpoints
│   ├── tools.ts               # Tool management
│   └── config.ts              # Config endpoints
├── websocket/
│   ├── index.ts               # WebSocket handler
│   ├── protocol.ts            # Message types
│   └── approval.ts            # Approval via WebSocket
├── middleware/
│   ├── auth.ts                # Authentication
│   ├── rate_limit.ts          # Rate limiting
│   └── correlation.ts         # Request ID correlation
└── auth/
    ├── pairing.ts             # Device pairing flow
    ├── tokens.ts              # Token management
    └── session.ts             # Session management
```

---

## Key Exports

```typescript
// src/gateway/index.ts
export { createGateway, type GatewayConfig } from './server'
export { type GatewayRoute } from './routes'
export { type WebSocketMessage, type WebSocketProtocol } from './websocket/protocol'
export { DevicePairing } from './auth/pairing'
```

---

## Implementation Requirements

### 1. Fastify Type Augmentation (types.ts)

**CRITICAL:** Augment Fastify types so `request.user` is properly typed.

```typescript
import { FastifyRequest } from 'fastify'

// Augment Fastify request to include user
declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string
      role: 'owner' | 'user'
    }
  }
}

// Shared context for all route handlers
export interface GatewayContext {
  orchestrator: Orchestrator
  sessionManager: SessionManager
  audit: AuditLogger
  config: AppConfig
}
```

### 2. Server Setup (server.ts)

```typescript
import Fastify, { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import rateLimit from '@fastify/rate-limit'
import { randomUUID } from 'crypto'
import { registerRoutes } from './routes'
import { registerWebSocket } from './websocket'
import { correlationMiddleware } from './middleware/correlation'
import { authMiddleware } from './middleware/auth'
import { GatewayContext } from './types'

export interface GatewayConfig {
  host: string
  port: number
  rateLimit: {
    max: number
    timeWindow: string
  }
}

export async function createGateway(
  config: GatewayConfig,
  context: GatewayContext
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  })

  // Register plugins
  await app.register(websocket)

  // Rate limiting (global default)
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    keyGenerator: (request) => request.user?.id ?? request.ip,
  })

  // Register middleware
  app.addHook('preHandler', correlationMiddleware)
  app.addHook('preHandler', authMiddleware)

  // Register routes with shared context
  registerRoutes(app, context)
  registerWebSocket(app, context)

  return app
}
```

### 3. Health Routes (routes/health.ts)

```typescript
import { FastifyInstance } from 'fastify'

export function registerHealthRoutes(app: FastifyInstance): void {
  // Basic health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // Detailed health check
  app.get('/health/detailed', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    }
  })

  // Readiness probe (for k8s)
  app.get('/ready', async () => {
    // Check provider connectivity, etc.
    return { ready: true }
  })
}
```

### 4. Session Routes (routes/sessions.ts)

```typescript
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { GatewayContext } from '../types'

const CreateSessionSchema = z.object({
  channel: z.string(),
  workDir: z.string().optional(),
})

export function registerSessionRoutes(
  app: FastifyInstance,
  ctx: GatewayContext
): void {
  const { sessionManager } = ctx
  // Create a new session
  app.post('/sessions', async (request, reply) => {
    const body = CreateSessionSchema.parse(request.body)
    const userId = request.user.id

    const session = await sessionManager.create({
      userId,
      channel: body.channel,
      workDir: body.workDir,
    })

    return reply.status(201).send({
      id: session.id,
      channel: session.channel,
      createdAt: session.createdAt,
    })
  })

  // Get session info
  app.get('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = await sessionManager.get(id)

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    // Check authorization
    if (session.userId !== request.user.id) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    return {
      id: session.id,
      channel: session.channel,
      createdAt: session.createdAt,
      messageCount: session.history.length,
    }
  })

  // Delete session
  app.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = await sessionManager.get(id)

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    if (session.userId !== request.user.id) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    await sessionManager.delete(id)
    return reply.status(204).send()
  })
}
```

### 5. Message Routes (routes/messages.ts)

**MVP Scope:** Skip message history endpoint until session persistence is stable.

```typescript
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { GatewayContext } from '../types'

const SendMessageSchema = z.object({
  content: z.string(),
  attachments: z.array(z.object({
    type: z.enum(['file', 'image']),
    name: z.string(),
    url: z.string().url().optional(),
    data: z.string().optional(),  // Base64
  })).optional(),
})

export function registerMessageRoutes(
  app: FastifyInstance,
  ctx: GatewayContext
): void {
  const { orchestrator, sessionManager } = ctx

  // Send message (non-streaming, returns full response)
  app.post('/sessions/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const body = SendMessageSchema.parse(request.body)

    const session = await sessionManager.get(sessionId)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    // Create HTTP channel for this request
    const httpChannel = new HttpChannel(request, reply)

    const response = await orchestrator.handleMessage(
      {
        id: randomUUID(),
        userId: request.user.id,
        content: body.content,
        attachments: body.attachments,
        timestamp: new Date(),
      },
      httpChannel,
      session
    )

    return {
      id: randomUUID(),
      content: response.content,
      toolCalls: response.toolCalls,
      timestamp: new Date().toISOString(),
    }
  })

  // Get message history (with privacy controls)
  app.get('/sessions/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const {
      limit = 50,
      before,
      includeContent = 'false',  // Default: don't include content
    } = request.query as { limit?: number; before?: string; includeContent?: string }

    const session = await sessionManager.get(sessionId)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    // Authorization check
    if (session.userId !== request.user.id) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    // Only owner can request content
    const showContent = includeContent === 'true' && request.user.role === 'owner'

    return {
      messages: session.history.slice(-limit).map((msg, index) => ({
        // Always include these (needed for UX)
        id: msg.id ?? `${sessionId}-${index}`,
        role: msg.role,
        timestamp: msg.timestamp,
        // Tool call metadata (not output)
        toolCallId: msg.toolCallId,
        hasToolCalls: (msg.toolCalls?.length ?? 0) > 0,
        // Content hash for deduplication/sync (always included)
        contentHash: hashContent(msg.content),
        // Optional content (owner only, explicit opt-in)
        ...(showContent && { content: msg.content }),
      })),
    }
  })
}

// Simple hash for content deduplication
function hashContent(content: string): string {
  const crypto = require('crypto')
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}
```

### 6. WebSocket Protocol (websocket/protocol.ts)

**IMPORTANT:** Approval requests include correlation IDs for audit and UI.

```typescript
// Approval request with full correlation for audit/UI
export interface ApprovalRequestMessage {
  type: 'approval_request'
  requestId: string           // Approval ID (for response matching)
  correlationId: string       // Orchestrator requestId (for audit)
  toolCallId: string          // Specific tool call being approved
  toolName: string            // Tool name for display
  request: ApprovalRequest    // Full approval details (summary, risks)
}

export type WebSocketMessage =
  // Client -> Server
  | { type: 'message'; content: string; attachments?: Attachment[] }
  | { type: 'approval_response'; requestId: string; approved: boolean }
  | { type: 'ping' }

  // Server -> Client
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string; summary?: string }
  | { type: 'tool_call_result'; id: string; name: string; success: boolean }
  | ApprovalRequestMessage
  | { type: 'message_complete'; usage: Usage }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' }

export function parseWebSocketMessage(data: string): WebSocketMessage {
  const parsed = JSON.parse(data)
  // Validate against schema
  return WebSocketMessageSchema.parse(parsed)
}

export function serializeWebSocketMessage(message: WebSocketMessage): string {
  return JSON.stringify(message)
}
```

### 7. WebSocket Handler (websocket/index.ts)

```typescript
import { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { parseWebSocketMessage, serializeWebSocketMessage } from './protocol'
import { GatewayContext } from '../types'

export function registerWebSocket(
  app: FastifyInstance,
  ctx: GatewayContext
): void {
  const { orchestrator, sessionManager } = ctx

  app.get('/ws', { websocket: true }, async (connection, request) => {
    const socket = connection.socket
    const userId = request.user.id

    // Create WebSocket channel
    const channel = new WebSocketChannel(socket)

    // Get or create session
    const session = await sessionManager.getOrCreate(userId, 'websocket', ctx.config)

    // Handle incoming messages
    socket.on('message', async (data) => {
      try {
        const message = parseWebSocketMessage(data.toString())

        switch (message.type) {
          case 'message':
            await orchestrator.handleMessage(
              {
                id: randomUUID(),
                userId,
                content: message.content,
                attachments: message.attachments,
                timestamp: new Date(),
              },
              channel,
              session
            )
            break

          case 'approval_response':
            channel.resolveApproval(message.requestId, message.approved)
            break

          case 'ping':
            socket.send(serializeWebSocketMessage({ type: 'pong' }))
            break
        }
      } catch (error) {
        socket.send(serializeWebSocketMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }))
      }
    })

    // Handle disconnect
    socket.on('close', () => {
      // Clean up pending approvals
      channel.cancelAllPendingApprovals()
    })
  })
}
```

### 8. WebSocket Channel (websocket/channel.ts)

```typescript
import { WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { Channel, ChannelMessage, ChannelResponse, ApprovalRequest } from '../../channels'
import { serializeWebSocketMessage, ApprovalRequestMessage } from './protocol'

export class WebSocketChannel implements Channel {
  name = 'websocket'
  private socket: WebSocket
  private pendingApprovals = new Map<string, {
    resolve: (approved: boolean) => void
    timeout: NodeJS.Timeout
    request: ApprovalRequest  // Store for "details" display
  }>()
  // Current orchestrator context for correlation
  private currentCorrelationId: string | null = null
  private currentToolCallId: string | null = null

  constructor(socket: WebSocket) {
    this.socket = socket
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {
    this.socket.close()
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse>): void {
    // Not used - WebSocket handler manages this
  }

  // Set context for correlation (called by orchestrator before tool execution)
  setCorrelationContext(correlationId: string, toolCallId: string): void {
    this.currentCorrelationId = correlationId
    this.currentToolCallId = toolCallId
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    const requestId = randomUUID()

    return new Promise((resolve) => {
      // Set timeout (30 seconds)
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId)
        resolve(false)  // Timeout = denied
      }, 30000)

      // Store request for "details" display
      this.pendingApprovals.set(requestId, { resolve, timeout, request })

      // Send approval request with full correlation IDs
      const approvalMessage: ApprovalRequestMessage = {
        type: 'approval_request',
        requestId,                                    // Approval ID (for response)
        correlationId: this.currentCorrelationId!,   // Orchestrator requestId
        toolCallId: this.currentToolCallId!,         // Specific tool call
        toolName: request.tool,                      // Tool name for display
        request,                                      // Full details
      }
      this.socket.send(serializeWebSocketMessage(approvalMessage))
    })
  }

  resolveApproval(requestId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingApprovals.delete(requestId)
      pending.resolve(approved)
    }
  }

  // Cancel all pending approvals (on disconnect)
  cancelAllPendingApprovals(): void {
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout)
      pending.resolve(false)  // Deny on disconnect
    }
    this.pendingApprovals.clear()
  }

  streamDelta(delta: string): void {
    this.socket.send(serializeWebSocketMessage({
      type: 'text_delta',
      delta,
    }))
  }

  streamComplete(): void {
    // Sent via message_complete event
  }

  // Include tool call ID for correlation
  onToolCallStart(name: string, summary?: string): void {
    this.socket.send(serializeWebSocketMessage({
      type: 'tool_call_start',
      id: this.currentToolCallId!,
      name,
      summary,
    }))
  }

  onToolCallResult(name: string, success: boolean): void {
    this.socket.send(serializeWebSocketMessage({
      type: 'tool_call_result',
      id: this.currentToolCallId!,
      name,
      success,
    }))
  }
}
```

### 9. Device Pairing (auth/pairing.ts)

```typescript
import { randomBytes } from 'crypto'

interface PairingCode {
  code: string
  expiresAt: Date
  deviceName: string
}

export class DevicePairing {
  private pendingCodes = new Map<string, PairingCode>()

  // Generate a 6-digit pairing code
  generateCode(deviceName: string): string {
    const code = randomBytes(3).toString('hex').toUpperCase().slice(0, 6)

    this.pendingCodes.set(code, {
      code,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),  // 5 minutes
      deviceName,
    })

    return code
  }

  // Verify and consume a pairing code
  async verifyCode(code: string, ownerId: string): Promise<{ token: string } | null> {
    const pending = this.pendingCodes.get(code)

    if (!pending) {
      return null
    }

    if (pending.expiresAt < new Date()) {
      this.pendingCodes.delete(code)
      return null
    }

    // Code is valid - generate token
    this.pendingCodes.delete(code)

    const token = await this.generateToken(ownerId, pending.deviceName)
    return { token }
  }

  private async generateToken(userId: string, deviceName: string): Promise<string> {
    // Generate secure token
    const token = randomBytes(32).toString('base64url')

    // Store token -> user mapping
    await tokenStore.save(token, { userId, deviceName, createdAt: new Date() })

    return token
  }
}
```

**Note:** Rate limiting is configured globally in `server.ts`. For stricter per-route limits,
use Fastify's route-level config:

```typescript
// In routes/messages.ts - stricter limit for message sending
app.post('/sessions/:sessionId/messages', {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
}, async (request, reply) => {
  // ...handler
})
```

---

## Tests

```
test/gateway/
├── server.test.ts             # Server setup
├── routes/
│   ├── health.test.ts
│   ├── sessions.test.ts
│   └── messages.test.ts
├── websocket/
│   ├── protocol.test.ts
│   └── channel.test.ts
├── middleware/
│   ├── auth.test.ts
│   └── rate_limit.test.ts
└── auth/
    └── pairing.test.ts
```

### Critical Test Cases

```typescript
// test/gateway/routes/health.test.ts
describe('Health endpoints', () => {
  it('returns ok for /health', async () => {
    const app = await createTestGateway()
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.objectContaining({ status: 'ok' }))
  })
})

// test/gateway/websocket/channel.test.ts
describe('WebSocketChannel', () => {
  it('streams text deltas', async () => {
    const socket = createMockWebSocket()
    const channel = new WebSocketChannel(socket)

    channel.streamDelta('Hello ')
    channel.streamDelta('World')

    expect(socket.sentMessages).toEqual([
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'World' },
    ])
  })

  it('handles approval with timeout', async () => {
    vi.useFakeTimers()
    const socket = createMockWebSocket()
    const channel = new WebSocketChannel(socket)

    const approvalPromise = channel.requestApproval({
      tool: 'bash',
      summary: 'Run command',
      risks: [],
    })

    // Fast-forward 31 seconds
    vi.advanceTimersByTime(31000)

    const result = await approvalPromise
    expect(result).toBe(false)  // Timeout = denied

    vi.useRealTimers()
  })
})

// test/gateway/auth/pairing.test.ts
describe('DevicePairing', () => {
  it('generates 6-character codes', () => {
    const pairing = new DevicePairing()
    const code = pairing.generateCode('My Phone')
    expect(code).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('verifies valid code', async () => {
    const pairing = new DevicePairing()
    const code = pairing.generateCode('My Phone')
    const result = await pairing.verifyCode(code, 'owner-id')
    expect(result).toBeTruthy()
    expect(result?.token).toBeTruthy()
  })

  it('rejects expired code', async () => {
    vi.useFakeTimers()
    const pairing = new DevicePairing()
    const code = pairing.generateCode('My Phone')

    // Fast-forward 6 minutes
    vi.advanceTimersByTime(6 * 60 * 1000)

    const result = await pairing.verifyCode(code, 'owner-id')
    expect(result).toBeNull()

    vi.useRealTimers()
  })
})
```

---

## Definition of Done

- [ ] HTTP server starts and responds to health checks
- [ ] REST endpoints match API.md specification
- [ ] WebSocket connection establishes successfully
- [ ] WebSocket streaming works (text deltas, tool events)
- [ ] Approval requests work via WebSocket
- [ ] Device pairing flow works (generate code → verify → token)
- [ ] Rate limiting enforced per user
- [ ] Request ID correlation throughout (x-request-id header)
- [ ] All tests pass
- [ ] `pnpm check` passes

---

## Dependencies to Add

```bash
pnpm add fastify @fastify/websocket @fastify/rate-limit
pnpm add ws
pnpm add @types/ws -D
```

---

## Next Milestone

After completing M9, proceed to [M10: Memory](./M10-memory.md) (Phase 2).

---

*Last updated: 2026-01-29*
