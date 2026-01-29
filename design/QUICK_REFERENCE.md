# Quick Reference Card

A cheat sheet for meao development. Print this or keep it open!

---

## Commands

```bash
# Daily workflow
pnpm check            # Run before every commit (typecheck + lint + test)
pnpm test:watch       # Keep running while coding
pnpm lint:fix         # Auto-fix lint errors

# Running tests
pnpm test                           # All tests
pnpm test src/config/               # Tests in a folder
pnpm test -t "NEVER_LOG"            # Tests matching pattern

# Git workflow
git checkout -b feature/m5-tools    # New branch
pnpm check && git commit            # Always check before commit
gh pr create                        # Create PR
```

---

## File Structure Cheat Sheet

```
Where do I put...?

New tool         → src/tools/builtin/<tool-name>.ts
New channel      → src/channels/<channel-name>/index.ts
New config       → src/config/schema.ts (add to Zod schema)
New audit event  → src/audit/types.ts (add to AuditCategory)
Secret pattern   → src/security/secrets/patterns.ts
Test file        → test/<same-path-as-src>/<file>.test.ts
```

---

## Key Types

```typescript
// Trust levels (low to high)
type TrustLevel = 'untrusted' | 'user' | 'verified'

// Data sensitivity (low to high)
type DataClass = 'public' | 'internal' | 'sensitive' | 'secret'

// Content label (every piece of data has one)
interface ContentLabel {
  trustLevel: TrustLevel
  dataClass: DataClass
  source: { origin: string; timestamp: Date }
}

// Combining labels: lowest trust + highest sensitivity wins
combineLabels(a, b) → { trustLevel: min(a, b), dataClass: max(a, b) }
```

---

## Security Rules

| Rule | What It Means |
|------|---------------|
| NEVER_LOG | Never log `metadata.message.content`, `metadata.tool.output`, `metadata.file.content` |
| One choke point | All tools → ToolExecutor, all network → NetworkGuard |
| Lowest trust wins | Combined content gets lowest trust level |
| Highest sensitivity wins | Combined content gets highest data class |
| bash = container | Shell commands always run in Docker with no network |

---

## Approval Levels

```
AUTO-APPROVE:
  • GET to known hosts (github.com, npmjs.com)
  • Read files in project directory

REQUIRES APPROVAL:
  • POST/PUT/DELETE to any host
  • Unknown hosts
  • bash commands
  • File writes

ALWAYS DANGEROUS (extra warning):
  • rm -rf
  • Writes outside project
  • Network from container
```

---

## Test Template

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('MyFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does the happy path', async () => {
    const result = await myFunction('valid input')
    expect(result.success).toBe(true)
  })

  it('handles edge case', async () => {
    const result = await myFunction('')
    expect(result.success).toBe(false)
  })

  it('throws on invalid input', async () => {
    await expect(myFunction(null as any)).rejects.toThrow()
  })
})
```

---

## Commit Message Format

```
<type>(<scope>): <description>

Types:
  feat     New feature
  fix      Bug fix
  refactor Code change (no new features/fixes)
  test     Adding tests
  docs     Documentation
  chore    Maintenance

Examples:
  feat(tools): implement bash tool
  fix(audit): prevent secret leakage in error messages
  test(config): add precedence chain tests
```

---

## Common Imports

```typescript
// Zod for validation
import { z } from 'zod'

// Node.js built-ins
import { randomUUID } from 'crypto'
import path from 'path'
import { promises as fs } from 'fs'

// Internal - Security
import { secretDetector } from '../security'
import { combineLabels, labelOutput } from '../security/labels'

// Internal - Audit
import { getAuditLogger } from '../audit'

// Internal - Config
import { loadConfig, type AppConfig } from '../config'
```

---

## Milestone Dependencies

```
Which milestone can I work on?

M0 (Repo Setup)     → ✅ DONE
M1 (Config)         → Needs M0  ← START HERE
M1.5 (Audit Thin)   → Needs M1
M2 (Security)       → Needs M0
M3 (Audit Full)     → Needs M1.5 + M2
M4 (Sandbox)        → Needs M3
M5 (Tools)          → Needs M3 + M4
M6 (CLI)            → Needs M5
M7 (Provider)       → Needs M1
M8 (Orchestrator)   → Needs M5 + M6 + M7  ← MVP COMPLETE!

Phase 2:
M9 (Gateway)        → Needs M8
M10 (Memory)        → Needs M8
M11 (Telegram)      → Needs M8

Phase 3 (Agent Framework):
M12 (Agent)         → Needs M9 + M10 + M11
M12.5 (Skills)      → Needs M12
M13 (Bootstrap)     → Needs M12
M14 (Scouts)        → Needs M12
M15 (Resilience)    → Needs M13
M16 (Voice)         → Needs M13 (optional)
M17 (Self-Healing)  → Needs M13

Phase 4:
M18 (Doris)         → Needs M12.5 + M13 + M14 + M15 + M17
```

---

## Phase 2 Patterns

### M9: Gateway Context Pattern
```typescript
// Pass shared context to route handlers
interface GatewayContext {
  orchestrator: Orchestrator
  sessionManager: SessionManager
  audit: AuditLogger
  config: AppConfig
}

// Approval messages need correlation IDs for audit trail
interface ApprovalRequestMessage {
  requestId: string       // Approval ID
  correlationId: string   // Orchestrator requestId
  toolCallId: string      // Specific tool call
  toolName: string        // Tool name for display
}
```

### M10: Memory Patterns
```typescript
// EpisodicMemory uses add(), not store() (naming collision)
await episodicMemory.add({ type: 'conversation', content: '...' })

// Mock embeddings for testing (use 'mock:' prefix)
const generator = new EmbeddingGenerator({ model: 'mock:128' })

// VectorStore is pluggable - MVP uses brute-force cosine similarity
```

### M11: Telegram Patterns
```typescript
// Use ownerUuid from config, not magic 'owner' string
interface TelegramChannelConfig {
  ownerId: string     // Telegram user ID
  ownerUuid: string   // Internal UUID from app config
}

// Dual rate limiting (both must pass)
rateLimit: {
  messagesPerMinute: 10,
  messagesPerHour: 100
}

// Stream buffering with 500ms throttle
streamDelta(delta) {
  // Buffer content, edit message every 500ms
}

// Download attachments server-side (no token URLs!)
const localPath = await downloadFile(botToken, file.file_path, fileName)
```

---

## Policy Enforcement Order

```
1. GLOBAL SECURITY  → Cannot be overridden (sandbox, NEVER_LOG, secrets)
2. ORG/APP POLICY   → Labels, allowlists, deny rules
3. AGENT AUTONOMY   → autoApprove/requireApproval (default = require)
4. USER CONFIRM     → Approval prompt if needed
```

**Invariant:** Agent autonomy CANNOT override global/org policy.

---

## Phase 3 Patterns (Agent Framework)

### M12: Agent Definition
```typescript
interface Agent {
  id: string
  identity: AgentIdentity        // Name, personality, traits
  memoryNamespace: string        // Isolated memory scope
  tools: string[]                // Allowed tools
  skills: string[]               // Registered skills
  autonomy: AutonomyConfig       // What can it do without asking?
}
```

### M13: Bootstrap Context
```typescript
// Load ~700 tokens BEFORE seeing user message
bootstrapCategories: [
  { name: 'identity', priority: 1, maxTokens: 100 },
  { name: 'family', priority: 2, maxTokens: 150 },
  { name: 'preferences', priority: 3, maxTokens: 200 },
]
```

### M14: Scout Scheduler
```typescript
// Jitter: 0-10% random delay to prevent stampedes
// Backoff: 15s → 30s → 60s → 120s → 300s max on failure
// Overlap: Skip if previous run still executing
```

---

## Phase 4 Patterns (Doris)

### Canonical ToolAction Format
```typescript
// Format: tool:action or tool:category:action
autonomy: {
  autoApprove: ['weather:current', 'calendar:read'],
  requireApproval: ['gmail:send', 'home_assistant:lock:unlock'],
}
```

### Memory Visibility
```typescript
type MemoryVisibility = 'owner' | 'family' | `user:${string}` | 'agent'

// Always set visibility when storing
await memory.add({ content: '...', visibility: 'owner' })
```

---

## Troubleshooting

```bash
# TypeScript errors after pulling
rm -rf node_modules/.cache && pnpm typecheck

# Tests fail randomly
pnpm test --clearCache

# pnpm install fails
rm -rf node_modules pnpm-lock.yaml && pnpm install

# Docker issues
docker ps                          # Is Docker running?
docker images | grep meao-sandbox  # Does image exist?
```

---

## Questions to Ask Yourself

Before submitting code:

- [ ] Does `pnpm check` pass?
- [ ] Did I write tests for new code?
- [ ] Could this log sensitive data? (Use NEVER_LOG fields)
- [ ] Could this expose secrets? (Run through SecretDetector)
- [ ] Does this need approval? (Add to ToolCapability)
- [ ] Did I update the milestone's Definition of Done?

---

## Getting Help

1. **Check the milestone doc** - Has detailed implementation
2. **Search existing code** - Similar patterns exist
3. **Read ONBOARDING.md** - Full explanations
4. **Ask in team chat** - We're here to help!

---

*Keep this open while coding!*

---

*Last updated: 2026-01-29 (v1.2 - Added Phase 3/4 patterns, Policy Enforcement Order, M0 complete)*
