# Milestone 3: Audit (Full)

**Status:** COMPLETE
**Scope:** MVP (SecretDetector integration) + Phase 2 (integrity, alerts)
**Dependencies:** M1.5 (Audit Thin), M2 (Security Primitives)
**PR:** PR4

---

## Goal

Upgrade M1.5 audit with SecretDetector integration for error message sanitization. Add CLI commands and optionally integrity/alerting features.

**Spec Reference:** [AUDIT.md](../AUDIT.md)

---

## File Structure (additions to M1.5)

```
src/audit/
├── index.ts                   # Extended exports
├── schema.ts                  # (from M1.5)
├── types.ts                   # (from M1.5)
├── redaction.ts               # UPGRADED: SecretDetector integration
├── store/
│   ├── interface.ts           # (from M1.5)
│   ├── jsonl.ts               # (from M1.5)
│   └── postgres.ts            # Phase 3
├── integrity.ts               # Phase 2: Hash chain
├── service.ts                 # (from M1.5)
├── alerts.ts                  # Phase 2: AlertEngine
├── retention.ts               # Phase 2: Cleanup
└── cli.ts                     # CLI commands
```

---

## Implementation Requirements

### 1. Upgraded Redaction (redaction.ts)

```typescript
import { secretDetector } from '../security'

// NEVER_LOG fields (same as M1.5)
const NEVER_LOG_FIELDS = [
  'message.content',
  'tool.output',
  'file.content',
  'memory.content',
  'response.text',
]

export function sanitizeAuditEntry(entry: AuditEntry): AuditEntry {
  const sanitized = structuredClone(entry)

  // Remove forbidden fields
  for (const field of NEVER_LOG_FIELDS) {
    deletePath(sanitized, field)
  }

  // UPGRADED: Sanitize error messages with SecretDetector
  if (sanitized.metadata?.errorMessage) {
    sanitized.metadata.errorMessage = sanitizeErrorMessage(
      String(sanitized.metadata.errorMessage)
    )
  }

  return sanitized
}

// UPGRADED from M1.5: Now uses secretDetector
export function sanitizeErrorMessage(msg: string): string {
  // 1. Redact secrets
  const { redacted } = secretDetector.redact(msg)
  // 2. Truncate to 500 chars
  return redacted.slice(0, 500)
}
```

### 2. Integrity Mode (Phase 2)

```typescript
// src/audit/integrity.ts
import crypto from 'crypto'
import { AuditEntry } from './types'

export interface IntegrityEntry extends AuditEntry {
  prev_hash: string | null
  entry_hash: string
}

export function computeEntryHash(
  entry: AuditEntry,
  prevHash: string | null
): string {
  const canonical = JSON.stringify({
    ...entry,
    prev_hash: prevHash,
  })
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

export async function verifyChain(
  entries: IntegrityEntry[]
): Promise<{ valid: boolean; brokenAt?: string }> {
  let prevHash: string | null = null

  for (const entry of entries) {
    const expected = computeEntryHash(entry, prevHash)
    if (entry.entry_hash !== expected) {
      return { valid: false, brokenAt: entry.id }
    }
    prevHash = entry.entry_hash
  }

  return { valid: true }
}
```

### 3. Alert Engine (Phase 2)

```typescript
// src/audit/alerts.ts
import { AuditEntry, AuditSeverity } from './types'

export interface AlertThreshold {
  category: string
  action: string
  countPerHour: number
  severity: AuditSeverity
  cooldownMs: number
}

export interface AlertAction {
  type: 'log' | 'notify' | 'block'
  entry: AuditEntry
  threshold: AlertThreshold
}

export class AlertEngine {
  private thresholds: AlertThreshold[] = []
  private counts = new Map<string, { count: number; windowStart: number }>()
  private cooldowns = new Map<string, number>()

  addThreshold(threshold: AlertThreshold): void {
    this.thresholds.push(threshold)
  }

  evaluate(entry: AuditEntry): AlertAction | null {
    const key = `${entry.category}:${entry.action}`
    const threshold = this.thresholds.find(
      t => t.category === entry.category && t.action === entry.action
    )

    if (!threshold) return null

    // Check cooldown
    const lastAlert = this.cooldowns.get(key) ?? 0
    if (Date.now() - lastAlert < threshold.cooldownMs) {
      return null
    }

    // Update count
    const now = Date.now()
    const hourAgo = now - 3600000
    let record = this.counts.get(key)

    if (!record || record.windowStart < hourAgo) {
      record = { count: 0, windowStart: now }
    }
    record.count++
    this.counts.set(key, record)

    // Check threshold
    if (record.count >= threshold.countPerHour) {
      this.cooldowns.set(key, now)
      return { type: 'notify', entry, threshold }
    }

    return null
  }
}
```

### 4. CLI Commands

```typescript
// src/audit/cli.ts
import { JsonlAuditStore } from './store/jsonl'

export async function tailAudit(options: {
  n?: number
  category?: string
  follow?: boolean
}): Promise<void> {
  const store = new JsonlAuditStore()
  const entries = await store.query({
    category: options.category,
    limit: options.n ?? 50,
  })

  for (const entry of entries) {
    console.log(formatEntry(entry))
  }

  if (options.follow) {
    // Watch for new entries
    // Implementation depends on file watching
  }
}

export async function searchAudit(options: {
  action?: string
  since?: string
  category?: string
}): Promise<void> {
  const store = new JsonlAuditStore()
  const since = options.since ? parseDuration(options.since) : undefined

  const entries = await store.query({
    action: options.action,
    category: options.category,
    since,
  })

  for (const entry of entries) {
    console.log(formatEntry(entry))
  }
}

function formatEntry(entry: AuditEntry): string {
  const time = new Date(entry.timestamp).toISOString()
  return `[${time}] [${entry.severity}] ${entry.category}:${entry.action}`
}
```

---

## Tests

```
test/audit/
├── redaction.test.ts          # UPGRADED: SecretDetector integration
├── integrity.test.ts          # Hash chain verification (Phase 2)
├── alerts.test.ts             # Alert thresholds (Phase 2)
└── cli.test.ts                # CLI commands
```

### Critical Test Cases

```typescript
// test/audit/redaction.test.ts
describe('sanitizeErrorMessage with SecretDetector', () => {
  it('redacts API keys in error messages', () => {
    const error = 'Failed to connect with key sk-ant-api03-xxxxx'
    const sanitized = sanitizeErrorMessage(error)
    expect(sanitized).toContain('[REDACTED:')
    expect(sanitized).not.toContain('sk-ant-api03')
  })

  it('truncates after redaction', () => {
    const longError = 'x'.repeat(1000) + ' ghp_' + 'x'.repeat(36)
    const sanitized = sanitizeErrorMessage(longError)
    expect(sanitized.length).toBeLessThanOrEqual(500)
  })
})

// test/audit/integrity.test.ts
describe('hash chain', () => {
  it('verifies valid chain', async () => {
    const entries = createChainedEntries(5)
    const result = await verifyChain(entries)
    expect(result.valid).toBe(true)
  })

  it('detects tampered entry', async () => {
    const entries = createChainedEntries(5)
    entries[2].action = 'tampered'  // Modify without updating hash
    const result = await verifyChain(entries)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(entries[2].id)
  })
})
```

---

## Definition of Done

**MVP (must complete):**
- [ ] Error messages sanitized through secretDetector + truncation
- [ ] NEVER_LOG test still passes
- [ ] CLI `meao audit tail` command works
- [ ] All tests pass
- [ ] `pnpm check` passes

**Phase 2 (can defer):**
- [ ] Hash chain integrity mode works
- [ ] `meao audit verify` command works
- [ ] Alert engine with thresholds
- [ ] Retention cleanup

---

## PR Checklist

```markdown
## PR4: Audit (Full)

### Changes
- [ ] Upgrade redaction to use secretDetector
- [ ] Add CLI tail command
- [ ] (Phase 2) Add integrity mode
- [ ] (Phase 2) Add alert engine

### Tests
- [ ] SecretDetector redaction in error messages
- [ ] NEVER_LOG still enforced
- [ ] CLI command tests

### Verification
- [ ] Error messages with secrets are properly redacted
- [ ] `meao audit tail` works
- [ ] `pnpm check` passes
```

---

## Next Milestone

After completing M3, proceed to [M4: Sandbox](./M4-sandbox.md).

---

*Last updated: 2026-01-29*
