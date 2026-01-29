# Audit Log Specification

**Status:** ACTIVE
**Version:** 1.0
**Last Updated:** 2026-01-29

This document defines the audit logging system for meao - what events are logged, the schema for audit entries, storage, retention, and query capabilities.

**Related Documents:**
- [SECURITY.md](./SECURITY.md) - Security invariants requiring audit (INV-7)
- [TOOL_CAPABILITY.md](./TOOL_CAPABILITY.md) - Tool audit policies
- [MEMORY.md](./MEMORY.md) - Memory operation auditing
- [LABELS.md](./LABELS.md) - Label flow auditing
- [SANDBOX.md](./SANDBOX.md) - Sandbox execution auditing

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                       AUDIT LOG SYSTEM                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PURPOSE:                                                           │
│  • Security compliance (who did what, when)                         │
│  • Incident investigation (trace attack paths)                      │
│  • Debugging (understand system behavior)                           │
│  • Accountability (tool executions, approvals)                      │
│                                                                      │
│  PRINCIPLES:                                                        │
│  • Append-only (immutable once written)                            │
│  • Privacy-aware (log metadata, not content)                       │
│  • Redacted (secrets never appear in logs)                         │
│  • Queryable (structured for analysis)                             │
│  • Retained (configurable, never auto-deleted for security events) │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Audit Entry Schema

### Base Schema

```typescript
import { z } from 'zod'
import { InternalIdSchema, CoercibleDateSchema } from './interfaces'

// Severity levels
export const AuditSeveritySchema = z.enum([
  'debug',     // Verbose debugging info
  'info',      // Normal operations
  'warning',   // Unusual but not dangerous
  'alert',     // Security-relevant, needs attention
  'critical',  // Security incident, immediate action needed
])

export type AuditSeverity = z.infer<typeof AuditSeveritySchema>

// Base audit entry (all entries extend this)
export const AuditEntryBaseSchema = z.object({
  // Identity
  id: InternalIdSchema,
  timestamp: CoercibleDateSchema,

  // Classification
  category: z.string(),              // 'auth', 'tool', 'memory', etc.
  action: z.string(),                // Specific action within category
  severity: AuditSeveritySchema,

  // Context
  userId: InternalIdSchema.optional(),
  sessionId: InternalIdSchema.optional(),
  requestId: InternalIdSchema.optional(),

  // Outcome
  success: z.boolean(),
  errorCode: z.string().optional(),
  // IMPORTANT: errorMessage MUST be sanitized before logging
  // - Run through SecretDetector.redact()
  // - Truncate to max 500 chars
  // - Strip stack traces (use errorCode + hash for correlation)
  errorMessage: z.string().max(500).optional(),

  // Source
  component: z.string(),             // 'gateway', 'orchestrator', 'tool:bash'
  version: z.string().optional(),    // Component version

  // Additional data (category-specific)
  metadata: z.record(z.unknown()).optional(),
})

export type AuditEntryBase = z.infer<typeof AuditEntryBaseSchema>
```

### Category-Specific Schemas

#### Authentication Events

```typescript
export const AuthAuditSchema = AuditEntryBaseSchema.extend({
  category: z.literal('auth'),
  action: z.enum([
    'login_success',
    'login_failure',
    'logout',
    'token_issued',
    'token_refreshed',
    'token_revoked',
    'token_invalid',
    'device_paired',
    'device_unpaired',
    'password_changed',
    'mfa_success',
    'mfa_failure',
  ]),
  metadata: z.object({
    // What was used to authenticate
    method: z.enum(['token', 'password', 'device', 'channel']).optional(),

    // Channel info (if channel-based auth)
    channelId: z.string().optional(),
    platformUserId: z.string().optional(),

    // Device info
    deviceId: z.string().optional(),
    deviceName: z.string().optional(),

    // Failure details (no secrets!)
    failureReason: z.string().optional(),

    // IP/location (if available)
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
  }).optional(),
})

export type AuthAudit = z.infer<typeof AuthAuditSchema>
```

#### Tool Execution Events

```typescript
export const ToolAuditSchema = AuditEntryBaseSchema.extend({
  category: z.literal('tool'),
  action: z.enum([
    'execution_started',
    'execution_completed',
    'execution_failed',
    'execution_timeout',
    'approval_requested',
    'approval_granted',
    'approval_denied',
    'approval_timeout',
    'sandbox_created',
    'sandbox_destroyed',
    'network_blocked',
    'path_blocked',
    'secret_redacted',
  ]),
  metadata: z.object({
    // Tool identity
    toolName: z.string(),
    toolCallId: z.string(),
    skillId: z.string().optional(),

    // Execution details
    sandboxLevel: z.enum(['none', 'process', 'container']).optional(),
    networkMode: z.enum(['none', 'proxy', 'host']).optional(),
    durationMs: z.number().optional(),

    // Arguments (REDACTED - only safe metadata)
    argsSummary: z.string().optional(),  // e.g., "path=/workspace/file.ts"
    argsHash: z.string().optional(),     // SHA256 for correlation

    // Output info (no content!)
    outputSize: z.number().optional(),
    outputTruncated: z.boolean().optional(),

    // Security events
    blockedPath: z.string().optional(),
    blockedHost: z.string().optional(),
    blockedReason: z.string().optional(),
    secretsRedactedCount: z.number().optional(),

    // Approval details
    approvalReason: z.string().optional(),
    approvedBy: z.string().optional(),
  }).optional(),
})

export type ToolAudit = z.infer<typeof ToolAuditSchema>
```

#### Memory Events

```typescript
export const MemoryAuditSchema = AuditEntryBaseSchema.extend({
  category: z.literal('memory'),
  action: z.enum([
    'episodic_write',
    'episodic_read',
    'episodic_delete',
    'semantic_write',
    'semantic_read',
    'semantic_delete',
    'memory_expired',
    'secret_blocked',
    'promotion_requested',
    'promotion_granted',
    'promotion_denied',
  ]),
  metadata: z.object({
    // Memory type
    memoryType: z.enum(['working', 'episodic', 'semantic']),
    memoryId: z.string().optional(),

    // Write details
    source: z.string().optional(),       // 'user_message', 'tool_output', etc.
    trustLevel: z.enum(['untrusted', 'verified', 'user', 'system']).optional(),
    dataClass: z.enum(['public', 'internal', 'sensitive', 'secret']).optional(),

    // Size info
    entryCount: z.number().optional(),
    contentSize: z.number().optional(),

    // Security events
    secretsBlocked: z.boolean().optional(),
    promotionReason: z.string().optional(),
  }).optional(),
})

export type MemoryAudit = z.infer<typeof MemoryAuditSchema>
```

#### Label Flow Events

```typescript
export const LabelAuditSchema = AuditEntryBaseSchema.extend({
  category: z.literal('label'),
  action: z.enum([
    'label_assigned',
    'label_propagated',
    'label_promoted',
    'flow_allowed',
    'flow_blocked',
    'flow_confirmed',
  ]),
  metadata: z.object({
    // Content identification (not content itself)
    contentType: z.string(),           // 'tool_output', 'message', 'memory'
    contentId: z.string().optional(),

    // Label info
    trustLevel: z.enum(['untrusted', 'verified', 'user', 'system']),
    dataClass: z.enum(['public', 'internal', 'sensitive', 'secret']),

    // For promotions
    previousTrustLevel: z.enum(['untrusted', 'verified', 'user', 'system']).optional(),
    promotionReason: z.string().optional(),

    // For flow decisions
    flowRule: z.string().optional(),    // 'FC-1', 'FC-2', 'FC-3'
    destination: z.string().optional(), // 'memory:semantic', 'egress:web'
    decision: z.enum(['allowed', 'blocked', 'confirmed']).optional(),
  }).optional(),
})

export type LabelAudit = z.infer<typeof LabelAuditSchema>
```

#### Channel Events

```typescript
export const ChannelAuditSchema = AuditEntryBaseSchema.extend({
  category: z.literal('channel'),
  action: z.enum([
    'channel_started',
    'channel_stopped',
    'channel_error',
    'message_received',
    'message_sent',
    'message_failed',
    'user_joined',
    'user_blocked',
    'rate_limited',
  ]),
  metadata: z.object({
    channelId: z.string(),
    channelType: z.string(),           // 'telegram', 'discord', 'cli'

    // Connection info
    connectionState: z.string().optional(),

    // Message info (no content!)
    messageId: z.string().optional(),
    conversationId: z.string().optional(),
    messageType: z.string().optional(), // 'text', 'image', 'file'
    messageSize: z.number().optional(),

    // User info
    platformUserId: z.string().optional(),

    // Rate limiting
    rateLimitType: z.string().optional(),
    rateLimitRemaining: z.number().optional(),
  }).optional(),
})

export type ChannelAudit = z.infer<typeof ChannelAuditSchema>
```

#### Configuration Events

```typescript
export const ConfigAuditSchema = AuditEntryBaseSchema.extend({
  category: z.literal('config'),
  action: z.enum([
    'config_loaded',
    'config_changed',
    'config_error',
    'secret_rotated',
    'key_generated',
    'key_rotated',
    'backup_created',
    'backup_restored',
    'audit_logs_deleted',       // When audit logs are purged
    'audit_logs_exported',      // When audit logs are exported
  ]),
  metadata: z.object({
    // What changed (no values!)
    configSection: z.string().optional(),
    changedKeys: z.array(z.string()).optional(),

    // Key management
    keyType: z.string().optional(),    // 'kek', 'credentials.dek', etc.

    // Backup info
    backupId: z.string().optional(),
    backupSize: z.number().optional(),
  }).optional(),
})

export type ConfigAudit = z.infer<typeof ConfigAuditSchema>
```

#### Sandbox/Network Events

```typescript
export const SandboxAuditSchema = AuditEntryBaseSchema.extend({
  category: z.literal('sandbox'),
  action: z.enum([
    'container_created',
    'container_started',
    'container_stopped',
    'container_killed',
    'network_request',
    'network_blocked',
    'dns_resolved',
    'dns_blocked',
    'resource_limit_hit',
  ]),
  metadata: z.object({
    // Container info
    containerId: z.string().optional(),
    imageName: z.string().optional(),
    networkMode: z.enum(['none', 'proxy', 'host']).optional(),

    // Resource usage
    cpuMs: z.number().optional(),
    memoryBytes: z.number().optional(),
    durationMs: z.number().optional(),

    // Network events
    targetHost: z.string().optional(),
    targetPort: z.number().optional(),
    resolvedIP: z.string().optional(),
    blockReason: z.string().optional(),

    // Limits
    limitType: z.string().optional(),   // 'memory', 'cpu', 'time', 'pids'
    limitValue: z.number().optional(),
    actualValue: z.number().optional(),
  }).optional(),
})

export type SandboxAudit = z.infer<typeof SandboxAuditSchema>
```

### Union Type

```typescript
// All audit entry types
export const AuditEntrySchema = z.discriminatedUnion('category', [
  AuthAuditSchema,
  ToolAuditSchema,
  MemoryAuditSchema,
  LabelAuditSchema,
  ChannelAuditSchema,
  ConfigAuditSchema,
  SandboxAuditSchema,
])

export type AuditEntry = z.infer<typeof AuditEntrySchema>
```

### Category Relationships

Some actions appear in multiple categories at different abstraction levels:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TOOL vs SANDBOX EVENTS                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TOOL CATEGORY (Policy Layer)                                       │
│  ─────────────────────────────                                       │
│  • Logs DECISIONS based on capability/labels/approval               │
│  • "Should this operation be allowed?"                              │
│  • tool.network_blocked = "policy said no network for this tool"   │
│  • tool.path_blocked = "path outside allowed workspace"            │
│                                                                      │
│  SANDBOX CATEGORY (Enforcement Layer)                               │
│  ────────────────────────────────────                                │
│  • Logs FACTS about actual execution                                │
│  • "What happened at the container/network level?"                  │
│  • sandbox.network_blocked = "proxy rejected connection to IP"     │
│  • sandbox.dns_blocked = "DNS resolved to private IP"              │
│                                                                      │
│  CORRELATION:                                                       │
│  Both events share toolCallId for end-to-end tracing               │
│  Tool event comes first (decision), sandbox event follows (fact)   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Severity Guidelines

| Severity | When to Use | Examples | Alert? |
|----------|-------------|----------|--------|
| `debug` | Verbose tracing | Tool args hash, container lifecycle | No |
| `info` | Normal operations | Login success, tool completed, message sent | No |
| `warning` | Unusual but handled | Rate limited, approval timeout, path blocked | No |
| `alert` | Security-relevant | Auth failure, secret redacted, flow blocked | Yes |
| `critical` | Incident requiring action | Multiple auth failures, sandbox escape attempt | Yes + Page |

### Escalation Rules

```typescript
const ALERT_THRESHOLDS = {
  // Auth failures
  authFailuresPerMinute: 5,          // → alert
  authFailuresPerHour: 20,           // → critical

  // Blocked operations
  blockedPathsPerSession: 3,         // → alert
  blockedNetworkPerSession: 5,       // → alert

  // Secret detections
  secretRedactionsPerSession: 10,    // → warning
  secretRedactionsPerHour: 50,       // → alert

  // Sandbox events
  resourceLimitHitsPerHour: 10,      // → alert
}
```

---

## What NOT to Log

**Never include in audit logs:**

```typescript
const NEVER_LOG = [
  // Actual content
  'message_content',
  'file_content',
  'tool_output_content',
  'memory_content',

  // Secrets
  'api_keys',
  'tokens',
  'passwords',
  'private_keys',
  'credentials',

  // Personal data beyond IDs
  'email_addresses',    // (unless specifically relevant to auth)
  'phone_numbers',
  'physical_addresses',

  // Full arguments (use summary/hash instead)
  'tool_arguments_raw',
  'command_full',
]
```

**Use instead:**

| Instead of | Use |
|------------|-----|
| Message content | `messageSize`, `messageType` |
| File content | `filename`, `fileSize`, `mimeType` |
| Tool arguments | `argsSummary`, `argsHash` |
| API keys | `keyType`, `keyPrefix` (first 4 chars) |
| Passwords | `passwordChanged: true` |

---

## Storage

### File Format

```
~/.meao/logs/
├── audit/
│   ├── audit-2026-01-29.jsonl       # Daily rotation
│   ├── audit-2026-01-28.jsonl
│   ├── audit-2026-01-27.jsonl.gz    # Compressed after 7 days
│   └── ...
└── app/
    ├── app.log                       # Application log (separate)
    └── ...
```

### JSONL Format

Each line is a complete JSON object:

```jsonl
{"id":"...","timestamp":"2026-01-29T10:00:00Z","category":"auth","action":"login_success",...}
{"id":"...","timestamp":"2026-01-29T10:00:01Z","category":"tool","action":"execution_started",...}
```

### Database Schema (PostgreSQL)

```sql
-- Main audit log table
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  category VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  user_id UUID,
  session_id UUID,
  request_id UUID,
  success BOOLEAN NOT NULL,
  error_code VARCHAR(50),
  error_message VARCHAR(500),    -- Truncated, sanitized
  component VARCHAR(100) NOT NULL,
  version VARCHAR(20),
  metadata JSONB,

  -- Integrity fields (optional, for tamper evidence)
  prev_hash VARCHAR(64),         -- SHA256 of previous entry
  entry_hash VARCHAR(64)         -- SHA256 of this entry
) PARTITION BY RANGE (timestamp);

-- Indexes for common queries
CREATE INDEX audit_log_timestamp_idx ON audit_log (timestamp DESC);
CREATE INDEX audit_log_category_action_idx ON audit_log (category, action);
CREATE INDEX audit_log_user_id_idx ON audit_log (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX audit_log_severity_idx ON audit_log (severity) WHERE severity IN ('alert', 'critical');
CREATE INDEX audit_log_session_idx ON audit_log (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX audit_log_request_idx ON audit_log (request_id) WHERE request_id IS NOT NULL;

-- Partitioning by month for large deployments
CREATE TABLE audit_log_2026_01 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_log_2026_02 PARTITION OF audit_log
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... create partitions as needed
```

---

## Integrity Mode (Optional)

For deployments where audit log tampering must be detectable:

### Hash Chain

Each entry includes a hash of the previous entry, creating an append-only chain:

```typescript
interface IntegrityFields {
  // SHA256 of previous entry (or null for first entry)
  prevHash: string | null

  // SHA256 of this entry (excluding entryHash itself)
  entryHash: string
}

function computeEntryHash(entry: AuditEntry, prevHash: string | null): string {
  const payload = {
    ...entry,
    prevHash,
    entryHash: undefined,  // Exclude from hash
  }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload, Object.keys(payload).sort()))
    .digest('hex')
}

async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  const lastEntry = await getLastEntry()
  const prevHash = lastEntry?.entryHash ?? null

  const entryHash = computeEntryHash(entry, prevHash)

  await db.audit_log.insert({
    ...entry,
    prev_hash: prevHash,
    entry_hash: entryHash,
  })
}
```

### Daily Digest

For external verification, publish a daily signed digest:

```typescript
interface DailyDigest {
  date: string                    // '2026-01-29'
  entryCount: number
  firstEntryHash: string
  lastEntryHash: string
  merkleRoot: string              // Root of Merkle tree over all entries

  // Signature (if key available)
  signature?: string
  signedBy?: string               // Key ID
}

// Store in separate, tamper-evident location
// e.g., ~/.meao/audit/digests/2026-01-29.json
```

### Verification

```bash
# Verify hash chain integrity
meao audit verify --since 2026-01-01

# Verify against external digest
meao audit verify --digest /path/to/digest.json

# Output:
# ✓ 15,234 entries verified
# ✓ Hash chain intact
# ✓ Merkle root matches digest
```

### Configuration

```typescript
interface IntegrityConfig {
  enabled: boolean              // Default: false

  // Hash chain
  hashChain: boolean            // Include prev_hash/entry_hash

  // Daily digests
  dailyDigest: boolean          // Generate daily digest files
  signDigests: boolean          // Sign digests with key
  digestKeyId: string           // Which key to use

  // External storage (for digest copies)
  externalStorage?: {
    type: 'git' | 's3' | 'webhook'
    config: Record<string, unknown>
  }
}
```

> **Note:** Integrity mode adds overhead and complexity. Enable only if you have compliance requirements or need provable audit trails for investigations.

---

## Retention Policy

```typescript
interface RetentionPolicy {
  // By severity
  debug: '7d',           // 7 days
  info: '30d',           // 30 days
  warning: '90d',        // 90 days
  alert: '1y',           // 1 year
  critical: 'forever',   // Never auto-delete

  // By category (overrides severity)
  auth: '1y',            // All auth events kept 1 year
  config: '1y',          // All config changes kept 1 year

  // Compression
  compressAfter: '7d',   // Compress files older than 7 days
  archiveAfter: '90d',   // Move to archive storage after 90 days
}
```

### Deletion Rules

```typescript
// Only allowed via explicit command
async function deleteAuditLogs(
  filter: AuditDeleteFilter,
  context: RequestContext
): Promise<DeleteResult> {
  // MUST be owner
  if (!isOwner(context.user)) {
    throw new SecurityError('Only owner can delete audit logs')
  }

  // Cannot delete critical or recent
  if (filter.severity === 'critical') {
    throw new SecurityError('Critical audit entries cannot be deleted')
  }

  if (filter.olderThan < days(30)) {
    throw new SecurityError('Cannot delete logs less than 30 days old')
  }

  // Log the deletion itself
  await audit.log({
    category: 'config',
    action: 'audit_logs_deleted',
    severity: 'alert',
    metadata: {
      filter,
      deletedCount: result.count,
    },
  })

  return result
}
```

---

## Query Interface

### CLI Commands

```bash
# View recent logs
meao audit tail                       # Last 100 entries
meao audit tail --severity alert      # Only alerts
meao audit tail -f                    # Follow mode

# Search
meao audit search --category tool --action execution_failed
meao audit search --user-id <uuid> --since 2026-01-28
meao audit search --tool-name bash --severity alert

# Export
meao audit export --since 2026-01-01 --format jsonl > audit.jsonl
meao audit export --category auth --format csv > auth.csv

# Stats
meao audit stats --since 2026-01-01
meao audit stats --category tool --group-by action
```

### Programmatic API

```typescript
interface AuditQuery {
  // Time range
  since?: Date
  until?: Date

  // Filters
  category?: string | string[]
  action?: string | string[]
  severity?: AuditSeverity | AuditSeverity[]
  userId?: string
  sessionId?: string
  success?: boolean
  component?: string

  // Metadata filters (JSONB path queries)
  metadata?: Record<string, unknown>

  // Pagination
  limit?: number        // Default: 100, Max: 1000
  offset?: number
  order?: 'asc' | 'desc'  // Default: 'desc' (newest first)
}

interface AuditService {
  // Write
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void>

  // Read
  query(query: AuditQuery): Promise<AuditEntry[]>
  count(query: AuditQuery): Promise<number>

  // Aggregations
  stats(query: AuditQuery, groupBy: string[]): Promise<AuditStats>

  // Stream
  tail(query: AuditQuery): AsyncIterable<AuditEntry>
  follow(): AsyncIterable<AuditEntry>

  // Export
  export(query: AuditQuery, format: 'jsonl' | 'csv'): AsyncIterable<string>
}
```

---

## Alerting Integration

### Alert Configuration

```typescript
interface AlertConfig {
  // Destinations
  destinations: {
    // Webhook (generic)
    webhook?: {
      url: string
      headers?: Record<string, string>
    }

    // Email (if configured)
    email?: {
      to: string[]
      onlyCritical?: boolean
    }

    // Push notification (if mobile app)
    push?: {
      enabled: boolean
    }
  }

  // Rules
  rules: AlertRule[]
}

interface AlertRule {
  name: string
  condition: {
    category?: string
    action?: string
    severity?: AuditSeverity[]
    threshold?: {
      count: number
      window: string      // '1m', '1h', etc.
    }
  }
  destinations: string[]  // Which destinations to alert
  cooldown?: string       // Don't re-alert within this window
}
```

### Default Rules

```typescript
const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: 'critical_events',
    condition: { severity: ['critical'] },
    destinations: ['all'],
    cooldown: '0',        // Always alert
  },
  {
    name: 'auth_failures',
    condition: {
      category: 'auth',
      action: 'login_failure',
      threshold: { count: 5, window: '5m' },
    },
    destinations: ['webhook', 'push'],
    cooldown: '15m',
  },
  {
    name: 'security_blocks',
    condition: {
      severity: ['alert'],
      category: 'sandbox',
      action: 'network_blocked',
      threshold: { count: 10, window: '1h' },
    },
    destinations: ['webhook'],
    cooldown: '1h',
  },
]
```

### Cooldown & Deduplication

To prevent alert storms from tight loops:

```typescript
interface AlertState {
  // Deduplication key (derived from rule + context)
  dedupeKey: string             // e.g., "auth_failures:user:123"

  // Cooldown tracking
  lastAlertTime: Date
  alertCount: number            // Within current window

  // Suppression
  suppressedCount: number       // Alerts not sent due to cooldown
}

function computeDedupeKey(rule: AlertRule, entry: AuditEntry): string {
  // Group by rule + user (if available) + action
  const parts = [rule.name]
  if (entry.userId) parts.push(`user:${entry.userId}`)
  if (entry.metadata?.toolName) parts.push(`tool:${entry.metadata.toolName}`)
  return parts.join(':')
}

async function shouldAlert(rule: AlertRule, entry: AuditEntry): Promise<boolean> {
  const key = computeDedupeKey(rule, entry)
  const state = await getAlertState(key)

  if (!state) return true  // First occurrence

  const cooldownMs = parseDuration(rule.cooldown ?? '5m')
  const elapsed = Date.now() - state.lastAlertTime.getTime()

  if (elapsed < cooldownMs) {
    // Within cooldown - suppress but track
    await incrementSuppressed(key)
    return false
  }

  return true
}
```

When cooldown expires, include suppressed count in next alert:
```
"5 additional auth_failure events suppressed during cooldown"
```

---

## Implementation Checklist

### Phase 1: Core

```
[ ] AuditService implementation
[ ] JSONL file writer with rotation
[ ] Basic query support
[ ] CLI: meao audit tail
```

### Phase 2: Categories

```
[ ] Auth audit events
[ ] Tool audit events
[ ] Memory audit events
[ ] Channel audit events
```

### Phase 3: Advanced

```
[ ] PostgreSQL storage backend
[ ] Label flow audit events
[ ] Sandbox audit events
[ ] Config audit events
```

### Phase 4: Operations

```
[ ] Retention enforcement
[ ] Compression
[ ] CLI: search, export, stats
[ ] Alerting integration
```

---

## Security Invariants

```
AUDIT-INV-1: All security-relevant events are logged
             (per SECURITY.md INV-7)

AUDIT-INV-2: Secrets never appear in audit logs

AUDIT-INV-3: Audit log is append-only during normal operation

AUDIT-INV-4: Audit log deletion requires owner + creates audit entry

AUDIT-INV-5: Critical severity entries are never auto-deleted
```

---

*This specification is living documentation. Update as audit requirements evolve.*

*Last updated: 2026-01-29*
