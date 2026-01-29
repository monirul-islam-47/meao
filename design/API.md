# Gateway API Specification

**Status:** ACTIVE
**Version:** 1.0
**Last Updated:** 2026-01-29

This document specifies the Gateway API - the HTTP and WebSocket protocol that clients use to communicate with meao.

**Related Documents:**
- [INTERFACES.md](./INTERFACES.md) - Type definitions
- [AUDIT.md](./AUDIT.md) - Request/session ID correlation
- [SECURITY.md](./SECURITY.md) - Authentication requirements

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GATEWAY API                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TRANSPORTS:                                                        │
│  • HTTP REST - Auth, health, management                             │
│  • WebSocket - Real-time messaging, streaming                       │
│                                                                      │
│  CLIENTS:                                                           │
│  • CLI (meao chat, meao config)                                    │
│  • Web dashboard                                                    │
│  • Channel plugins (internal)                                       │
│                                                                      │
│  SECURITY:                                                          │
│  • Token-based auth required (even localhost)                       │
│  • All requests carry requestId for audit correlation               │
│  • Rate limiting per client                                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Transport & Endpoints

### Base Configuration

```typescript
interface GatewayConfig {
  host: string              // Default: '127.0.0.1'
  port: number              // Default: 3000

  // TLS (optional, recommended for non-localhost)
  tls?: {
    cert: string            // Path to certificate
    key: string             // Path to private key
  }

  // CORS (for web dashboard)
  cors?: {
    enabled: boolean
    origins: string[]       // Allowed origins
  }
}
```

### Endpoints

| Endpoint | Protocol | Auth Required | Purpose |
|----------|----------|---------------|---------|
| `/health` | HTTP GET | No | Health check |
| `/api/v1/*` | HTTP | Yes | REST API |
| `/ws` | WebSocket | Yes | Real-time messaging |

### Version Negotiation

```
Base URL: http://localhost:3000/api/v1

Version in URL path (not headers):
  /api/v1/...   - Current stable
  /api/v2/...   - Future breaking changes

WebSocket protocol version in connection:
  ws://localhost:3000/ws?v=1
```

---

## Authentication

### Token Types

```typescript
interface AuthToken {
  type: 'bearer'
  token: string             // Opaque token string

  // Token metadata (not in token itself)
  userId: string
  deviceId?: string
  scopes: string[]          // 'read', 'write', 'admin'
  expiresAt: Date
  issuedAt: Date
}
```

### Device Pairing Flow

First-time device authentication:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DEVICE PAIRING FLOW                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Client requests pairing code                                    │
│     POST /api/v1/auth/pair/request                                 │
│     → { pairingCode: "ABC123", expiresIn: 300 }                   │
│                                                                      │
│  2. User confirms code via existing channel (CLI, Telegram)        │
│     "Pair device ABC123"                                            │
│                                                                      │
│  3. Client polls for completion                                     │
│     POST /api/v1/auth/pair/complete                                │
│     { pairingCode: "ABC123" }                                      │
│     → { token: "...", deviceId: "...", expiresAt: "..." }         │
│                                                                      │
│  4. Client stores token, uses for future requests                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Token Operations

```typescript
// POST /api/v1/auth/pair/request
interface PairRequestResponse {
  pairingCode: string       // 6-char alphanumeric
  expiresIn: number         // Seconds until expiry
}

// POST /api/v1/auth/pair/complete
interface PairCompleteRequest {
  pairingCode: string
  deviceName?: string       // Optional device name
}

interface PairCompleteResponse {
  token: string
  deviceId: string
  expiresAt: string         // ISO date
  refreshToken?: string     // For long-lived sessions
}

// POST /api/v1/auth/refresh
interface RefreshRequest {
  refreshToken: string
}

interface RefreshResponse {
  token: string
  expiresAt: string
}

// POST /api/v1/auth/revoke
interface RevokeRequest {
  token?: string            // Revoke specific token
  deviceId?: string         // Revoke all tokens for device
  all?: boolean             // Revoke all tokens (except current)
}
```

### Request Authentication

All authenticated requests must include:

```http
Authorization: Bearer <token>
X-Request-ID: <uuid>
```

Example:
```http
GET /api/v1/sessions HTTP/1.1
Host: localhost:3000
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

---

## Core Message Envelope

Every request/response follows a consistent envelope:

### Request Envelope

```typescript
interface APIRequest<T = unknown> {
  // Always present
  requestId: string         // UUID, for audit correlation

  // Auth context (derived from token, not in body)
  // userId: string
  // sessionId: string

  // Request-specific payload
  data: T
}
```

### Response Envelope

```typescript
interface APIResponse<T = unknown> {
  // Always present
  requestId: string         // Echo back for correlation
  timestamp: string         // ISO date

  // Success case
  success: true
  data: T

  // OR Error case
  success: false
  error: APIError
}

interface APIError {
  code: string              // Machine-readable: 'AUTH_INVALID_TOKEN'
  message: string           // Human-readable (sanitized, no secrets)
  details?: unknown         // Additional context (optional)

  // For retryable errors
  retryable?: boolean
  retryAfter?: number       // Seconds
}
```

### Error Codes

```typescript
const ERROR_CODES = {
  // Authentication (4xx)
  AUTH_REQUIRED: 'Authentication required',
  AUTH_INVALID_TOKEN: 'Invalid or expired token',
  AUTH_INSUFFICIENT_SCOPE: 'Token lacks required scope',
  AUTH_DEVICE_NOT_PAIRED: 'Device not paired',

  // Authorization (4xx)
  FORBIDDEN: 'Operation not permitted',
  NOT_FOUND: 'Resource not found',
  RATE_LIMITED: 'Too many requests',

  // Validation (4xx)
  INVALID_REQUEST: 'Request validation failed',
  INVALID_PARAMETER: 'Invalid parameter value',

  // Server (5xx)
  INTERNAL_ERROR: 'Internal server error',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
  PROVIDER_ERROR: 'AI provider error',

  // Tool-specific (4xx)
  TOOL_NOT_FOUND: 'Tool not found',
  TOOL_APPROVAL_REQUIRED: 'Tool requires approval',
  TOOL_APPROVAL_DENIED: 'Tool approval denied',
  TOOL_EXECUTION_FAILED: 'Tool execution failed',
  TOOL_TIMEOUT: 'Tool execution timed out',
} as const

type ErrorCode = keyof typeof ERROR_CODES
```

### Error Message Sanitization

Error messages MUST be sanitized before returning to clients:

```typescript
function sanitizeErrorMessage(error: Error): string {
  let message = error.message

  // Run through secret detector
  message = SecretDetector.redact(message)

  // Strip stack traces
  message = message.split('\n')[0]

  // Truncate
  if (message.length > 200) {
    message = message.slice(0, 200) + '...'
  }

  return message
}
```

---

## HTTP REST API

### Health

```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": "healthy",
    "providers": "healthy",
    "channels": {
      "telegram": "healthy",
      "cli": "healthy"
    }
  }
}
```

### Sessions

```http
# List sessions
GET /api/v1/sessions
GET /api/v1/sessions?status=active&limit=10

# Get session
GET /api/v1/sessions/:sessionId

# Create session
POST /api/v1/sessions
{
  "channelId": "cli"
}

# End session
DELETE /api/v1/sessions/:sessionId
```

### Messages (HTTP - non-streaming)

```http
# Send message and get complete response
POST /api/v1/sessions/:sessionId/messages
{
  "content": [{ "type": "text", "text": "Hello" }]
}

Response:
{
  "requestId": "...",
  "success": true,
  "data": {
    "messageId": "...",
    "response": {
      "content": [{ "type": "text", "text": "Hello! How can I help?" }],
      "toolCalls": []
    }
  }
}
```

### Tools

```http
# List available tools
GET /api/v1/tools

# Get tool details
GET /api/v1/tools/:toolName

# Respond to approval request
POST /api/v1/approvals/:approvalId
{
  "approved": true
}
```

### Configuration

```http
# Get config (safe fields only)
GET /api/v1/config

# Update config
PATCH /api/v1/config
{
  "logging": { "level": "debug" }
}
```

---

## WebSocket Protocol

### Connection

```typescript
// Connect with auth
const ws = new WebSocket('ws://localhost:3000/ws?v=1', {
  headers: {
    'Authorization': `Bearer ${token}`,
  }
})

// Or send auth after connect
ws.send(JSON.stringify({
  type: 'auth',
  token: '...',
}))
```

### Message Format

All WebSocket messages are JSON with a `type` discriminator:

```typescript
// Client → Server
type ClientMessage =
  | AuthMessage
  | ChatMessage
  | ApprovalResponse
  | CancelRequest
  | PingMessage

// Server → Client
type ServerMessage =
  | AuthResult
  | TextDelta
  | ToolCallStart
  | ToolCallDelta
  | ToolCallEnd
  | ApprovalRequest
  | MessageComplete
  | ErrorMessage
  | PongMessage
```

### Client Messages

```typescript
// Authentication (if not in headers)
interface AuthMessage {
  type: 'auth'
  token: string
  requestId: string
}

// Send chat message
interface ChatMessage {
  type: 'chat'
  requestId: string
  sessionId: string
  content: MessageContent[]
}

// Respond to tool approval
interface ApprovalResponse {
  type: 'approval_response'
  requestId: string
  approvalId: string
  approved: boolean
  trustSession?: boolean    // Trust this tool for rest of session
}

// Cancel ongoing operation
interface CancelRequest {
  type: 'cancel'
  requestId: string
  targetRequestId: string   // Which request to cancel
}

// Keep-alive
interface PingMessage {
  type: 'ping'
  timestamp: number
}
```

### Server Messages

```typescript
// Auth result
interface AuthResult {
  type: 'auth_result'
  requestId: string
  success: boolean
  error?: APIError
  userId?: string
  sessionId?: string
}

// Streaming text from AI
interface TextDelta {
  type: 'text_delta'
  requestId: string
  delta: string             // Incremental text
}

// Tool call lifecycle
interface ToolCallStart {
  type: 'tool_call_start'
  requestId: string
  toolCallId: string
  toolName: string
}

interface ToolCallDelta {
  type: 'tool_call_delta'
  requestId: string
  toolCallId: string
  argumentsDelta: string    // Incremental JSON
}

interface ToolCallEnd {
  type: 'tool_call_end'
  requestId: string
  toolCallId: string
  result: ToolResult
}

// Approval request (blocks until response)
interface ApprovalRequest {
  type: 'approval_request'
  requestId: string
  approvalId: string
  toolName: string
  toolCallId: string
  reason: string
  argsSummary: string       // Safe summary (not raw args)
  timeout: number           // Seconds until auto-deny
}

// Message complete
interface MessageComplete {
  type: 'message_complete'
  requestId: string
  messageId: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

// Error
interface ErrorMessage {
  type: 'error'
  requestId: string
  error: APIError
}

// Keep-alive response
interface PongMessage {
  type: 'pong'
  timestamp: number
  serverTime: number
}
```

### Streaming Example

```
Client → Server:
  {"type":"chat","requestId":"req-1","sessionId":"sess-1","content":[{"type":"text","text":"List files"}]}

Server → Client:
  {"type":"text_delta","requestId":"req-1","delta":"I'll list"}
  {"type":"text_delta","requestId":"req-1","delta":" the files"}
  {"type":"text_delta","requestId":"req-1","delta":" for you."}
  {"type":"tool_call_start","requestId":"req-1","toolCallId":"tc-1","toolName":"bash"}
  {"type":"tool_call_delta","requestId":"req-1","toolCallId":"tc-1","argumentsDelta":"{\"command\":\"ls\"}"}
  {"type":"approval_request","requestId":"req-1","approvalId":"apr-1","toolName":"bash","toolCallId":"tc-1","reason":"Execute shell command","argsSummary":"command: ls","timeout":60}

Client → Server:
  {"type":"approval_response","requestId":"req-1","approvalId":"apr-1","approved":true}

Server → Client:
  {"type":"tool_call_end","requestId":"req-1","toolCallId":"tc-1","result":{"success":true,"output":"file1.txt\nfile2.txt"}}
  {"type":"text_delta","requestId":"req-1","delta":"Here are the files:\n- file1.txt\n- file2.txt"}
  {"type":"message_complete","requestId":"req-1","messageId":"msg-1","usage":{"inputTokens":50,"outputTokens":30}}
```

---

## Tool Approval UX

### Approval Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      TOOL APPROVAL FLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. AI requests tool execution                                      │
│     → ToolCallStart sent to client                                 │
│                                                                      │
│  2. Gateway checks tool capability                                  │
│     if (capability.approval === 'auto') → execute immediately      │
│     if (capability.approval === 'ask')  → request approval         │
│     if (capability.approval === 'always') → request approval       │
│                                                                      │
│  3. ApprovalRequest sent to client                                  │
│     - Includes safe summary of arguments                           │
│     - Includes timeout (default: 60s)                              │
│                                                                      │
│  4. Client displays approval prompt to user                         │
│     - Shows tool name, reason, args summary                        │
│     - Approve / Deny / Trust for session                           │
│                                                                      │
│  5. Client sends ApprovalResponse                                   │
│     - approved: true/false                                          │
│     - trustSession: grant for rest of session                      │
│                                                                      │
│  6. If approved → execute tool → ToolCallEnd                       │
│     If denied → ToolCallEnd with error                             │
│     If timeout → auto-deny → ToolCallEnd with error                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Audit Correlation

Every approval maps to audit events:

| API Event | Audit Entry |
|-----------|-------------|
| ApprovalRequest sent | `tool.approval_requested` |
| ApprovalResponse (approved) | `tool.approval_granted` |
| ApprovalResponse (denied) | `tool.approval_denied` |
| Timeout | `tool.approval_timeout` → `tool.approval_denied` |

---

## Rate Limiting

### Limits

```typescript
interface RateLimits {
  // Per token/device
  requestsPerMinute: 60
  requestsPerHour: 1000

  // WebSocket
  messagesPerMinute: 30
  connectionsPerIP: 5

  // Tool-specific
  toolExecutionsPerMinute: 20
  approvalRequestsPerMinute: 10
}
```

### Response Headers

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1706529600
```

### Rate Limit Error

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryable": true,
    "retryAfter": 30
  }
}
```

### Audit Correlation

Rate limit events generate audit entries:
```typescript
{
  category: 'channel',
  action: 'rate_limited',
  metadata: {
    limitType: 'requests_per_minute',
    limit: 60,
    current: 61,
  }
}
```

---

## Channel Identity Mapping

How channel users map to meao users/sessions:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    IDENTITY FLOW                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TELEGRAM MESSAGE                                                   │
│  ─────────────────                                                   │
│  from.id: 123456789                                                 │
│  chat.id: 123456789 (DM)                                           │
│                                                                      │
│       ↓                                                              │
│                                                                      │
│  CHANNEL PLUGIN                                                     │
│  ──────────────                                                      │
│  Creates IncomingMessage:                                           │
│    channelId: 'telegram'                                            │
│    senderId: '123456789'                                           │
│    conversationId: '123456789'                                     │
│                                                                      │
│       ↓                                                              │
│                                                                      │
│  GATEWAY                                                            │
│  ───────                                                             │
│  Looks up User by channel identity:                                 │
│    identities: [{ channelId: 'telegram', platformUserId: '123..'}] │
│                                                                      │
│  Gets or creates Session:                                           │
│    userId: '<internal-uuid>'                                        │
│    sessionId: '<internal-uuid>'                                     │
│    channelId: 'telegram'                                            │
│    conversationId: '123456789'                                     │
│                                                                      │
│       ↓                                                              │
│                                                                      │
│  REQUEST CONTEXT                                                    │
│  ───────────────                                                     │
│  userId, sessionId, requestId all UUIDs                            │
│  Passed to all handlers, logged in audit                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Audit Export (CLI Only)

For security, audit export is CLI-only (not via API):

```bash
# Export requires local access
meao audit export --since 2026-01-01 --format jsonl > audit.jsonl

# Query via CLI
meao audit search --category tool --user-id <uuid>
```

The API does not expose audit logs to prevent remote exfiltration. Web dashboard can show recent activity but not export.

---

## WebSocket Connection Lifecycle

```typescript
// Connection states
type ConnectionState =
  | 'connecting'
  | 'authenticating'
  | 'authenticated'
  | 'disconnecting'
  | 'disconnected'

// Reconnection with exponential backoff
interface ReconnectConfig {
  initialDelay: 1000        // 1 second
  maxDelay: 30000           // 30 seconds
  multiplier: 2
  jitter: 0.1               // 10% random jitter
}

// Heartbeat
interface HeartbeatConfig {
  interval: 30000           // Send ping every 30s
  timeout: 10000            // Disconnect if no pong in 10s
}
```

### Connection Events

```typescript
// Server-side connection events → audit log
{
  category: 'channel',
  action: 'ws_connected',     // or 'ws_disconnected', 'ws_error'
  metadata: {
    deviceId: '...',
    ipAddress: '...',
    userAgent: '...',
  }
}
```

---

## Security Considerations

### Token Security

- Tokens are opaque (no embedded claims visible to client)
- Tokens expire (default: 24h for access, 30d for refresh)
- Tokens are single-use for refresh (rotation on each refresh)
- Revocation is immediate (checked on every request)

### Request Validation

```typescript
// All incoming requests validated with Zod
function validateRequest<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new APIError('INVALID_REQUEST', result.error.message)
  }
  return result.data
}
```

### WebSocket Security

- Same auth requirements as HTTP
- Connection closed on auth failure
- Rate limiting per connection
- Message size limits (default: 1MB)
- Idle timeout (default: 5 minutes without messages)

---

## Implementation Checklist

### Phase 1: Core

```
[ ] HTTP server (Hono)
[ ] Health endpoint
[ ] Token authentication
[ ] Request/response envelope
[ ] Error handling
```

### Phase 2: WebSocket

```
[ ] WebSocket server
[ ] Auth handshake
[ ] Message routing
[ ] Streaming text
[ ] Heartbeat/ping-pong
```

### Phase 3: Tool Integration

```
[ ] Tool call streaming
[ ] Approval request/response
[ ] Timeout handling
[ ] Trust session
```

### Phase 4: Operations

```
[ ] Rate limiting
[ ] Device pairing
[ ] Token refresh/revoke
[ ] Reconnection handling
```

---

*This specification is living documentation. Update as API evolves.*

*Last updated: 2026-01-29*
