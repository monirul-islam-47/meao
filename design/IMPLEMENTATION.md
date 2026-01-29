# Implementation Plan

**Status:** ACTIVE
**Version:** 2.1
**Last Updated:** 2026-01-29

This document defines the complete implementation roadmap for meao. It follows a "vertical slice" strategy optimized for solo development.

**Related Documents:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [INTERFACES.md](./INTERFACES.md) - Type definitions and schemas
- [CONFIG.md](./CONFIG.md) - Configuration system
- [AUDIT.md](./AUDIT.md) - Audit logging
- [SANDBOX.md](./SANDBOX.md) - Execution isolation
- [TOOL_CAPABILITY.md](./TOOL_CAPABILITY.md) - Tool security policies

---

## Strategy: Vertical Slice First

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SOLO-DEV IMPLEMENTATION STRATEGY                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ANTI-PATTERN: Build subsystems in isolation, integrate too late         │
│                                                                          │
│  PATTERN: Build ONE complete flow end-to-end, then widen                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  CLI input → Orchestrator → Provider → Tool execution            │   │
│  │  (with approval + sandbox + secret redaction + labels + audit)   │   │
│  │  → Response → Audit entries                                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Then expand: HTTP/WS gateway, Telegram, memory tiers, Postgres, etc.   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why CLI First?

1. **Fastest feedback loop** - No network layer, no auth complexity
2. **Approval UX is simpler** - stdin/stdout prompts
3. **De-risks the hard parts** - Tool execution, sandbox, audit all get tested
4. **Gateway becomes a thin wrapper** - Core logic already validated

### Golden Path Demo Target

```
User: "Fetch the npm docs for lodash"
  ↓
Orchestrator receives message
  ↓
Provider returns tool call: web_fetch("https://www.npmjs.com/package/lodash")
  ↓
ToolExecutor:
  • GET to known host → auto-approved
  • Execute via process sandbox
  • Sanitize output (SecretDetector)
  • Label as untrusted/internal
  ↓
Audit entry logged (NO page content, just metadata)
  ↓
Provider receives tool result, generates response
  ↓
User sees answer
```

---

## Project Guardrails

These invariants prevent architecture drift during implementation:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ARCHITECTURAL INVARIANTS                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. ONE enforcement choke point for tools: ToolExecutor                  │
│     → All tool calls flow through here, no exceptions                    │
│                                                                          │
│  2. ONE choke point for network egress: NetworkGuard                     │
│     → DNS validation, IP blocking, allowlist enforcement                 │
│                                                                          │
│  3. ONE place for secret redaction: SecretDetector                       │
│     → Used by audit, tools, memory — never bypass                        │
│                                                                          │
│  4. ONE place for audit writes: AuditLogger                              │
│     → NEVER_LOG enforced here, cannot be circumvented                    │
│                                                                          │
│  5. NEVER_LOG unit test must pass before merge                           │
│     → If it fails, the PR cannot be merged                               │
│                                                                          │
│  6. Golden-path E2E test must pass before new features                   │
│     → CLI → tool → response → audit working = green light                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Policy Enforcement Order

When evaluating whether a tool action should proceed, policies are checked in this order. **Earlier layers cannot be bypassed by later layers.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         POLICY ENFORCEMENT ORDER                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. GLOBAL SECURITY POLICY (platform level - cannot be overridden)       │
│     → Tool capability restrictions (read vs write vs execute)            │
│     → Sandbox enforcement (bash always containerized)                    │
│     → Secret detection (redact before any output)                        │
│     → NEVER_LOG rules (content never reaches logs)                       │
│                                                                          │
│  2. ORG/APP POLICY (deployment level)                                    │
│     → Content labels (trust levels, data classification)                 │
│     → Network allowlists (which hosts can be contacted)                  │
│     → Deny rules (explicit blocks on specific actions)                   │
│                                                                          │
│  3. AGENT AUTONOMY POLICY (agent-specific)                               │
│     → autoApprove rules (actions agent can take without asking)          │
│     → requireApproval rules (actions that need user confirmation)        │
│     → Default: unknown actions require approval                          │
│                                                                          │
│  4. USER CONFIRMATION UX (runtime)                                       │
│     → Display approval prompt with action details                        │
│     → Wait for explicit user approval or denial                          │
│     → Audit the decision                                                 │
│                                                                          │
│  INVARIANT: Agent autonomy CANNOT override global/org policy.            │
│  An agent saying "autoApprove: ['*']" still respects sandbox rules.      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## MVP Scope

Not everything needs to be built at once. Explicit scoping prevents overbuilding.

| Feature | MVP (Must) | Phase 2 (Should) | Phase 3 (Agent Framework) | Phase 4 (Reference Agent) |
|---------|------------|------------------|---------------------------|---------------------------|
| **Config** | Precedence chain, env parsing | Hot-reload | Migration wizard | - |
| **Audit** | JSONL + NEVER_LOG | Hash chain integrity | Postgres store, alerting | - |
| **Security** | SecretDetector, labels | Flow control rules | Advanced taint tracking | - |
| **Sandbox** | Process sandbox, container w/ network=none | - | Proxy egress mode | - |
| **Tools** | read, write, web_fetch, bash | edit | Custom tool plugins | - |
| **Provider** | Anthropic | OpenAI | Ollama, failover | Tiered (Opus/Haiku) |
| **Channels** | CLI | Telegram | Discord, Slack, Voice (optional) | - |
| **Memory** | Working memory | Episodic, Semantic | Bootstrap context loading | Agent-scoped memory |
| **Gateway** | - | HTTP + WebSocket | Rate limiting, pairing | - |
| **Agents** | - | - | Agent framework, Skills | Doris reference agent |
| **Scouts** | - | - | Scout framework, scheduler | Doris-specific scouts |
| **Resilience** | - | - | Circuit breakers, fallbacks | - |
| **Self-Healing** | - | - | Auto-diagnosis, PR workflow | - |

**MVP Definition:** CLI golden path works end-to-end with audit + security enforced.

**Phase 3 Definition:** Agent framework complete - can define agents with identity, skills, memory, and proactive capabilities.

**Phase 4 Definition:** Doris reference agent complete - demonstrates full personal assistant with all capabilities.

---

## Milestone Overview

| Milestone | Name | Purpose | Dependency | Scope |
|-----------|------|---------|------------|-------|
| 0 | Repo Setup | Build discipline, test runner | None | MVP |
| 1 | Config System | Configuration + credentials | M0 | MVP |
| 1.5 | Audit (Thin) | JSONL logger + NEVER_LOG | M1 | MVP |
| 2 | Security Primitives | SecretDetector + Labels | M0 | MVP |
| 3 | Audit (Full) | Upgrade with SecretDetector | M1.5, M2 | MVP |
| 4 | Sandbox | Process + container isolation | M3 | MVP |
| 5 | Tool System | Registry + executor + builtins | M3, M4 | MVP |
| 6 | CLI Channel | First user interface | M5 | MVP |
| 7 | Provider | MockProvider then Anthropic | M1 | MVP |
| 8 | Orchestrator | Message routing loop | M5, M6, M7 | MVP |
| 9 | Gateway | HTTP + WebSocket API | M8 | Phase 2 |
| 10 | Memory | Working + episodic + semantic | M8 | Phase 2 |
| 11 | Telegram | Second channel | M8 | Phase 2 |
| 12 | Agent Framework | Agent identity, lifecycle, registry | M8, M10 | Phase 3 |
| 12.5 | Skills Framework | Skill definition, registry, execution | M12 | Phase 3 |
| 13 | Bootstrap & Context | Memory loading, extraction, reasoning | M12, M10 | Phase 3 |
| 14 | Background Scouts | Proactive monitoring, escalation | M12 | Phase 3 |
| 15 | Resilience | Circuit breakers, health, fallbacks | M5 | Phase 3 |
| 16 | Voice Channel | Wake word, STT, TTS, speaker ID | M12 | Phase 3 (Optional) |
| 17 | Self-Healing | Error diagnosis, auto-fix, PR workflow | M12, M5 | Phase 3 |
| 18 | Doris Agent | Reference personal assistant | M12-M17 | Phase 4 |

```
Dependency Graph:

M0 ─┬─→ M1 ─→ M1.5 ─┬─→ M3 ─→ M4 ─→ M5 ─┬─→ M6 ─┬─→ M8 ─┬─→ M9
    │               │                    │       │       │
    └─→ M2 ─────────┘                    │       │       ├─→ M10 ─┬─→ M12 ─→ M12.5 ─┬─→ M13
                                         │       │       │        │                  │
                                         └─→ M7 ─┘       └─→ M11  ├─→ M14            ├─→ M16 (opt)
                                                                  │                  │
                                                                  └─→ M15            └─→ M17

                                         M12 + M12.5 + M13 + M14 + M15 + M17 ──────────→ M18

MVP boundary:     M0 → M8
Phase 2 boundary: M9, M10, M11
Phase 3 boundary: M12, M12.5, M13, M14, M15, M16, M17
Phase 4 boundary: M18 (Doris)
```

---

## Milestone 0: Repository Setup

**Goal:** Establish build discipline before writing any business logic.

### Deliverables

```
meao/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.js
├── .prettierrc
├── .gitignore
├── bin/
│   └── meao                    # CLI entry point (stub)
├── src/
│   └── index.ts               # Main entry (stub)
└── test/
    └── setup.ts               # Test utilities
```

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm,cjs --dts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src test --ext .ts",
    "lint:fix": "eslint src test --ext .ts --fix",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  }
}
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Dependencies

```json
{
  "dependencies": {
    "zod": "^3.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "typescript": "^5.x",
    "tsx": "^4.x",
    "tsup": "^8.x",
    "vitest": "^1.x",
    "@vitest/coverage-v8": "^1.x",
    "eslint": "^8.x",
    "@typescript-eslint/eslint-plugin": "^7.x",
    "@typescript-eslint/parser": "^7.x",
    "prettier": "^3.x"
  }
}
```

### Definition of Done

- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` runs (even with 0 tests)
- [ ] `pnpm build` produces `dist/` output
- [ ] `./bin/meao --version` prints version

---

## Milestone 1: Configuration System

**Goal:** Implement the full configuration precedence chain with credential resolution.

**Spec Reference:** [CONFIG.md](./CONFIG.md)

### File Structure

```
src/config/
├── index.ts                   # Public exports
├── schema.ts                  # Zod schemas + AppConfig type
├── defaults.ts                # getDefaults()
├── paths.ts                   # getMeaoHome(), getConfigPath(), etc.
├── env.ts                     # parseEnvConfig(), parseValue()
├── file.ts                    # loadConfigFile(), saveConfigFile()
├── merge.ts                   # deepMerge()
├── loader.ts                  # loadConfig(cliArgs)
├── manager.ts                 # ConfigManager class
├── credentials.ts             # CredentialStore, resolveCredential()
├── validation.ts              # validateConfig() semantic checks
├── migration.ts               # Schema migrations
└── watch.ts                   # Hot-reload file watcher
```

### Key Exports

```typescript
// src/config/index.ts
export { AppConfigSchema, type AppConfig } from './schema'
export { getDefaults } from './defaults'
export { getMeaoHome, getConfigPath, getCredentialsPath } from './paths'
export { loadConfig } from './loader'
export { ConfigManager } from './manager'
export { resolveCredential, CredentialStore } from './credentials'
export { validateConfig, type ValidationResult } from './validation'
```

### Implementation Requirements

#### Precedence Chain (loader.ts)

```typescript
// Must match CONFIG.md exactly:
// 1. defaults
// 2. config.json
// 3. config.local.json
// 4. environment variables
// 5. CLI arguments
// 6. Zod validation
```

#### Environment Parsing (env.ts)

```typescript
// Must implement:
// - Skip MEAO_HOME (reserved)
// - Skip MEAO_*_API_KEY, MEAO_*_TOKEN (credentials)
// - Double underscore (__) = deep nesting
// - Single underscore (_) = section separator
// - parseValue: bool/number/JSON/string
```

#### Credential Resolution (credentials.ts)

```typescript
// Must implement:
// 1. Check environment override first (MEAO_<REF>)
// 2. Load from encrypted store
// 3. Throw ConfigError if not found
```

### Tests

```
test/config/
├── schema.test.ts             # Zod validation edge cases
├── env.test.ts                # Env var parsing
├── precedence.test.ts         # Full precedence chain
├── credentials.test.ts        # Credential resolution
├── migration.test.ts          # Schema migrations
└── validation.test.ts         # Semantic validation
```

#### Critical Test Cases

```typescript
// test/config/env.test.ts
describe('parseEnvConfig', () => {
  it('converts MEAO_SERVER_HOST to server.host', () => {
    // Single underscore = section separator
  })

  it('converts MEAO_PROVIDERS__PRIMARY__TYPE to providers.primary.type', () => {
    // Double underscore = deep nesting
  })

  it('skips MEAO_HOME', () => {
    // Reserved variable
  })

  it('skips MEAO_ANTHROPIC_API_KEY', () => {
    // Credential override, handled by resolveCredential
  })

  it('parses boolean values', () => {
    // 'true' -> true, 'false' -> false
  })

  it('parses numeric values', () => {
    // '3000' -> 3000, '0.7' -> 0.7
  })

  it('parses JSON arrays and objects', () => {
    // '[1,2,3]' -> [1,2,3]
  })
})

// test/config/precedence.test.ts
describe('loadConfig precedence', () => {
  it('CLI overrides environment', () => {})
  it('environment overrides user config', () => {})
  it('user config overrides defaults', () => {})
  it('local config overrides main config', () => {})
})
```

### CLI Commands

```bash
meao config show [path]        # View config
meao config set <path> <value> # Set value
meao config reset [path]       # Reset to default
meao config validate           # Validate config
meao config edit               # Open in $EDITOR

meao config set-secret <name>  # Set credential (interactive)
meao config list-secrets       # List credential names
meao config delete-secret <name>
```

### Definition of Done

- [ ] `loadConfig()` implements exact precedence chain from CONFIG.md
- [ ] Environment parsing handles `_` and `__` correctly
- [ ] Credential env vars are excluded from config parsing
- [ ] `resolveCredential()` checks env override first
- [ ] `meao config validate` shows actionable error messages
- [ ] Hot-reload works for non-sensitive settings
- [ ] All tests pass

---

## Milestone 1.5: Audit (Thin Logger)

**Goal:** Get observability early with minimal coupling. Audit traces help debug config/security/tool issues from day one.

**Scope:** MVP (thin version first, upgrade in M3)

### File Structure

```
src/audit/
├── index.ts                   # Public exports
├── types.ts                   # AuditEntry, AuditCategory, AuditSeverity
├── schema.ts                  # Zod schemas for entries
├── redaction.ts               # NEVER_LOG enforcement (simple truncation first)
├── store/
│   ├── interface.ts           # AuditStore interface
│   └── jsonl.ts               # JSONL implementation
└── service.ts                 # AuditLogger class
```

### Key Exports

```typescript
// src/audit/index.ts
export { AuditLogger } from './service'
export { type AuditEntry, type AuditCategory, type AuditSeverity } from './types'
export { sanitizeAuditEntry } from './redaction'
export { JsonlAuditStore } from './store/jsonl'
```

### Implementation Requirements

#### NEVER_LOG (Simple Version)

```typescript
// In M1.5: Simple truncation, no SecretDetector yet
// Paths are RELATIVE TO ROOT of AuditEntry (e.g., entry.metadata.message.content)
// The 'metadata.' prefix is part of the path, NOT a base path
const NEVER_LOG_FIELDS = [
  'metadata.message.content',   // User message text
  'metadata.tool.output',       // Raw tool output
  'metadata.file.content',      // File contents
  'metadata.memory.content',    // Memory entry content
  'metadata.response.text',     // AI response text
]

function sanitizeAuditEntry(entry: AuditEntry): AuditEntry {
  const sanitized = structuredClone(entry)

  for (const field of NEVER_LOG_FIELDS) {
    deletePath(sanitized, field)
  }

  // Simple truncation for error messages (SecretDetector added in M3)
  if (sanitized.metadata?.errorMessage) {
    sanitized.metadata.errorMessage =
      sanitized.metadata.errorMessage.slice(0, 500)
  }

  return sanitized
}
```

#### JSONL Store (Minimal)

```typescript
class JsonlAuditStore implements AuditStore {
  async append(entry: AuditEntry): Promise<void> {
    const sanitized = sanitizeAuditEntry(entry)
    const filename = `audit-${new Date().toISOString().slice(0, 10)}.jsonl`
    const line = JSON.stringify(sanitized) + '\n'
    await fs.appendFile(path.join(this.basePath, filename), line)
  }
}
```

### Tests

```
test/audit/
├── never_log.test.ts          # CRITICAL: NEVER_LOG enforcement
├── jsonl.test.ts              # Basic append + daily rotation
└── schema.test.ts             # Entry validation
```

#### Critical Test (Must Pass Before Any Merge)

```typescript
// test/audit/never_log.test.ts
describe('NEVER_LOG enforcement', () => {
  it('removes message.content even if caller provides it', () => {
    const entry = {
      category: 'channel',
      action: 'message_received',
      metadata: { message: { content: 'secret user message' } }
    }
    const sanitized = sanitizeAuditEntry(entry)
    expect(sanitized.metadata.message.content).toBeUndefined()
  })

  it('removes tool.output', () => {
    const entry = {
      category: 'tool',
      action: 'tool_executed',
      metadata: { tool: { output: 'secret file contents' } }
    }
    const sanitized = sanitizeAuditEntry(entry)
    expect(sanitized.metadata.tool.output).toBeUndefined()
  })

  it('truncates errorMessage to 500 chars', () => {
    const longError = 'x'.repeat(1000)
    const entry = {
      category: 'tool',
      action: 'tool_failed',
      metadata: { errorMessage: longError }
    }
    const sanitized = sanitizeAuditEntry(entry)
    expect(sanitized.metadata.errorMessage.length).toBe(500)
  })
})
```

### Definition of Done

- [ ] AuditLogger can append entries to JSONL
- [ ] Daily file rotation works (audit-YYYY-MM-DD.jsonl)
- [ ] NEVER_LOG fields enforced (cannot log even if passed)
- [ ] NEVER_LOG test passes
- [ ] All tests pass

**Note:** This is intentionally minimal. M3 adds SecretDetector integration, hash chains, alerts, and CLI commands.

---

## Milestone 2: Security Primitives

**Goal:** Build shared security modules used by tools, memory, and audit.

**Spec References:** [SECRET_DETECTION.md](./SECRET_DETECTION.md), [LABELS.md](./LABELS.md)

### File Structure

```
src/security/
├── index.ts                   # Public exports
├── secrets/
│   ├── index.ts
│   ├── types.ts               # SecretFinding, Confidence
│   ├── patterns.ts            # DEFINITE/PROBABLE/POSSIBLE patterns
│   ├── detector.ts            # SecretDetector class
│   └── context.ts             # Context-aware false positive reduction
├── labels/
│   ├── index.ts
│   ├── types.ts               # TrustLevel, DataClass, ContentLabel
│   ├── propagation.ts         # combineLabels(), taint rules
│   └── output.ts              # labelOutput() for tools
├── network/
│   ├── index.ts               # NetworkGuard singleton export
│   ├── guard.ts               # NetworkGuard class (single choke point)
│   ├── dns.ts                 # DNS validation, rebinding protection
│   └── allowlist.ts           # Host allowlist management
└── flow/
    ├── index.ts
    └── control.ts             # canEgress(), canWriteMemory()
```

### Key Exports

```typescript
// src/security/index.ts
// Export SINGLETON instance, not class (consistent usage everywhere)
export { secretDetector, type SecretFinding, type Confidence } from './secrets'
export {
  type TrustLevel,
  type DataClass,
  type ContentLabel,
  combineLabels,
  labelOutput,
} from './labels'
export { networkGuard, type NetworkCheckResult } from './network'
export { canEgress, canWriteSemanticMemory } from './flow'
```

#### NetworkGuard (network/guard.ts) - SINGLE CHOKE POINT

**ALL network egress MUST go through NetworkGuard. This is an architectural invariant.**

```typescript
interface NetworkCheckResult {
  allowed: boolean
  reason?: string
  resolvedIp?: string
}

class NetworkGuard {
  constructor(private config: NetworkConfig) {}

  /**
   * Check if a URL is allowed for network egress.
   * Called by: web_fetch tool, any future network tools
   */
  async checkUrl(url: string, method: string): Promise<NetworkCheckResult> {
    const parsed = new URL(url)

    // 1. Check allowlist (host + method)
    if (!this.isHostAllowed(parsed.hostname, method)) {
      return { allowed: false, reason: `Host not in allowlist: ${parsed.hostname}` }
    }

    // 2. DNS validation (prevent rebinding attacks)
    const dnsResult = await this.validateDns(parsed.hostname)
    if (!dnsResult.safe) {
      return { allowed: false, reason: dnsResult.reason }
    }

    // 3. Block private IPs
    if (this.isPrivateIp(dnsResult.ip)) {
      return { allowed: false, reason: 'Private IP not allowed' }
    }

    return { allowed: true, resolvedIp: dnsResult.ip }
  }

  private isHostAllowed(hostname: string, method: string): boolean {
    const rule = this.config.allowlist.find(r =>
      this.matchHost(hostname, r.host)
    )
    if (!rule) return false

    // GET always allowed if host matches
    if (method === 'GET') return true

    // Non-GET requires explicit permission
    return rule.methods?.includes(method) ?? false
  }

  private matchHost(hostname: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)  // '.example.com'
      return hostname.endsWith(suffix) || hostname === pattern.slice(2)
    }
    return hostname === pattern
  }

  private async validateDns(hostname: string): Promise<{ safe: boolean; ip?: string; reason?: string }> {
    // Resolve and cache with short TTL
    // Check for DNS rebinding (IP changed since last check)
    // Implementation in dns.ts
  }

  private isPrivateIp(ip: string): boolean {
    // IPv4: RFC 1918 + loopback + link-local + metadata
    // 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x, 169.254.x.x
    //
    // IPv6: loopback + private + link-local
    // ::1 (loopback)
    // fc00::/7 (ULA - unique local addresses)
    // fe80::/10 (link-local)
    //
    // Must handle both A and AAAA DNS results
  }
}

// Export singleton
export const networkGuard = new NetworkGuard(getNetworkConfig())
```

**Usage in ToolExecutor:**

```typescript
// In ToolExecutor.enforceNetwork()
private async enforceNetwork(tool: Tool, args: unknown): Promise<{ allowed: boolean; reason?: string }> {
  if (tool.name === 'web_fetch') {
    const { url, method = 'GET' } = args as { url: string; method?: string }
    return networkGuard.checkUrl(url, method)
  }
  return { allowed: true }
}
```

### Implementation Requirements

#### SecretDetector (secrets/detector.ts)

```typescript
class SecretDetector {
  // Scan text and return findings with confidence levels
  scan(text: string): SecretFinding[]

  // Redact secrets and return both redacted text and findings
  redact(text: string): { redacted: string; findings: SecretFinding[] }

  // Summarize findings for audit metadata (no actual secrets)
  summarize(findings: SecretFinding[]): SecretSummary
}

// Export singleton instance (not class) for consistent usage
// Used by: audit (redaction), tools (output sanitization), memory (write rules)
export const secretDetector = new SecretDetector()

interface SecretFinding {
  type: string           // 'aws_key', 'jwt', 'private_key', etc.
  confidence: Confidence // 'definite' | 'probable' | 'possible'
  line: number
  column: number
  length: number
  context: string        // Surrounding context (redacted)
}
```

#### Pattern Tiers (secrets/patterns.ts)

```typescript
// DEFINITE: Structure alone proves it's a secret
const DEFINITE_PATTERNS = [
  { name: 'aws_secret_key', pattern: /(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/, ... },
  { name: 'github_token', pattern: /ghp_[A-Za-z0-9]{36}/, ... },
  { name: 'private_key', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, ... },
]

// PROBABLE: High confidence but needs context
const PROBABLE_PATTERNS = [
  { name: 'generic_api_key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_-]{20,})/, ... },
  { name: 'bearer_token', pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/, ... },
]

// POSSIBLE: May be secret, context-dependent
const POSSIBLE_PATTERNS = [
  { name: 'high_entropy_string', pattern: /[A-Za-z0-9]{32,}/, validator: entropyCheck },
  { name: 'password_assignment', pattern: /password\s*[:=]\s*['"]([^'"]+)['"]/, ... },
]
```

#### Labels Engine (labels/propagation.ts)

**Trust Level Semantics (explicit ordering):**

```typescript
// TRUST ORDERING: untrusted < user < verified
// Lower trust = less authority, requires more scrutiny
type TrustLevel = 'untrusted' | 'user' | 'verified'

const TRUST_ORDER: Record<TrustLevel, number> = {
  untrusted: 0,  // External/unknown source (web content, decoded data)
  user: 1,       // User-provided or user-influenced content
  verified: 2,   // System-generated, trusted source
}

// DATA CLASS ORDERING: public < internal < sensitive < secret
type DataClass = 'public' | 'internal' | 'sensitive' | 'secret'

const DATA_CLASS_ORDER: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  secret: 3,
}
```

```typescript
// Taint propagation: lowest trust wins, highest sensitivity wins
function combineLabels(a: ContentLabel, b: ContentLabel): ContentLabel {
  return {
    trustLevel: minTrust(a.trustLevel, b.trustLevel),
    dataClass: maxSensitivity(a.dataClass, b.dataClass),
    source: { origin: 'combined', timestamp: new Date() },
    inheritedFrom: a, // or b, depending on which was more restrictive
  }
}

function minTrust(a: TrustLevel, b: TrustLevel): TrustLevel {
  return TRUST_ORDER[a] < TRUST_ORDER[b] ? a : b
}

function maxSensitivity(a: DataClass, b: DataClass): DataClass {
  return DATA_CLASS_ORDER[a] > DATA_CLASS_ORDER[b] ? a : b
}

// Label tool output based on capability + secret findings
function labelOutput(
  toolCapability: ToolCapability,
  secretFindings: SecretFinding[]
): ContentLabel {
  let dataClass = toolCapability.labels?.outputDataClass ?? 'internal'

  // Secrets elevate data class
  if (secretFindings.some(f => f.confidence === 'definite')) {
    dataClass = 'secret'
  } else if (secretFindings.some(f => f.confidence === 'probable')) {
    dataClass = maxSensitivity(dataClass, 'sensitive')
  }

  return {
    trustLevel: toolCapability.labels?.outputTrust ?? 'verified',
    dataClass,
    source: { origin: `tool:${toolCapability.name}`, timestamp: new Date() },
  }
}
```

#### Flow Control (flow/control.ts)

```typescript
// FC-1: Egress requires trust >= verified for sensitive+ data
function canEgress(label: ContentLabel, destination: string): FlowDecision {
  if (label.dataClass === 'secret') {
    return { allowed: false, reason: 'Secret data cannot egress' }
  }
  if (label.dataClass === 'sensitive' && label.trustLevel === 'untrusted') {
    return { allowed: false, reason: 'Untrusted sensitive data cannot egress' }
  }
  return { allowed: true }
}

// FC-2: Semantic memory requires trust >= verified
function canWriteSemanticMemory(label: ContentLabel): FlowDecision {
  if (label.trustLevel === 'untrusted') {
    return {
      allowed: false,
      reason: 'Untrusted content cannot write to semantic memory',
      canOverride: true, // User can confirm
    }
  }
  return { allowed: true }
}
```

### Tests

```
test/security/
├── secrets/
│   ├── patterns.test.ts       # Pattern matching
│   ├── detector.test.ts       # Scan + redact
│   └── false_positives.test.ts # Context-aware reduction
├── labels/
│   ├── propagation.test.ts    # combineLabels()
│   └── output.test.ts         # labelOutput()
└── flow/
    └── control.test.ts        # canEgress(), canWriteSemanticMemory()
```

#### Critical Test Cases

```typescript
// test/security/secrets/patterns.test.ts
describe('SecretDetector', () => {
  it('detects AWS secret keys with definite confidence', () => {})
  it('detects GitHub tokens', () => {})
  it('detects private keys', () => {})
  it('reduces false positives for UUIDs', () => {})
  it('reduces false positives for base64 images', () => {})
  it('redacts secrets while preserving context', () => {})
})

// test/security/labels/propagation.test.ts
describe('combineLabels', () => {
  it('uses lowest trust level', () => {
    const a = { trustLevel: 'user', dataClass: 'public' }
    const b = { trustLevel: 'untrusted', dataClass: 'public' }
    expect(combineLabels(a, b).trustLevel).toBe('untrusted')
  })

  it('uses highest sensitivity', () => {
    const a = { trustLevel: 'user', dataClass: 'public' }
    const b = { trustLevel: 'user', dataClass: 'sensitive' }
    expect(combineLabels(a, b).dataClass).toBe('sensitive')
  })
})
```

### Definition of Done

- [ ] SecretDetector implements all pattern tiers from SECRET_DETECTION.md
- [ ] Context-aware false positive reduction works
- [ ] `combineLabels()` follows "lowest trust, highest sensitivity" rule
- [ ] `labelOutput()` elevates data class based on secret findings
- [ ] Flow control functions enforce LABELS.md rules
- [ ] All tests pass with good coverage

---

## Milestone 3: Audit (Full)

**Goal:** Upgrade M1.5 audit with SecretDetector integration, integrity mode, and CLI commands.

**Scope:** MVP (SecretDetector integration) + Phase 2 (integrity, alerts)

**Spec Reference:** [AUDIT.md](./AUDIT.md)

### File Structure (additions to M1.5)

```
src/audit/
├── index.ts                   # Public exports (extended)
├── schema.ts                  # (from M1.5)
├── types.ts                   # (from M1.5)
├── redaction.ts               # UPGRADED: SecretDetector integration
├── store/
│   ├── interface.ts           # (from M1.5)
│   ├── jsonl.ts               # (from M1.5)
│   └── postgres.ts            # Phase 3: Postgres backend
├── integrity.ts               # Phase 2: Hash chain, daily digests
├── service.ts                 # (from M1.5)
├── alerts.ts                  # Phase 2: AlertEngine, thresholds
├── retention.ts               # Phase 2: Cleanup by severity
└── cli.ts                     # CLI commands (audit tail/search/export)
```

### Key Exports

```typescript
// src/audit/index.ts (extended from M1.5)
export { AuditLogger } from './service'
export { type AuditEntry, type AuditCategory, type AuditSeverity } from './types'
export { sanitizeAuditEntry, sanitizeErrorMessage } from './redaction'
export { JsonlAuditStore } from './store/jsonl'
// Phase 2:
export { AlertEngine } from './alerts'
export { computeEntryHash, verifyChain } from './integrity'
```

### Implementation Requirements

#### Audit Categories & Actions

```typescript
type AuditCategory =
  | 'auth'       // login, logout, pairing, token operations
  | 'tool'       // Tool policy layer (approval, execution, completion)
  | 'memory'     // Memory operations (read, write, delete)
  | 'label'      // Label changes (promotion, demotion)
  | 'channel'    // Channel events (connect, message, error)
  | 'config'     // Config changes (updated, secret operations)
  | 'sandbox'    // Enforcement layer (container events, network blocks)
  | 'scout'      // Background scout events (findings, errors, escalations)
  | 'resilience' // Circuit breaker events (open, half-open, close, fallback)
```

#### NEVER_LOG Enforcement (redaction.ts) - UPGRADED from M1.5

```typescript
// Fields that must NEVER appear in audit logs (same as M1.5)
// Paths are RELATIVE TO ROOT of AuditEntry (e.g., entry.metadata.message.content)
const NEVER_LOG_FIELDS = [
  'metadata.message.content',   // User message text
  'metadata.tool.output',       // Raw tool output
  'metadata.file.content',      // File contents
  'metadata.memory.content',    // Memory entry content
  'metadata.response.text',     // AI response text
]

function sanitizeAuditEntry(entry: AuditEntry): AuditEntry {
  // Deep clone
  const sanitized = structuredClone(entry)

  // Remove forbidden fields (same as M1.5)
  for (const field of NEVER_LOG_FIELDS) {
    deletePath(sanitized, field)
  }

  // UPGRADED: Sanitize error messages with SecretDetector
  if (sanitized.metadata?.errorMessage) {
    sanitized.metadata.errorMessage = sanitizeErrorMessage(
      sanitized.metadata.errorMessage
    )
  }

  return sanitized
}

// UPGRADED from M1.5: Now uses secretDetector singleton
function sanitizeErrorMessage(msg: string): string {
  // 1. Run through secretDetector singleton (NEW in M3)
  const { redacted } = secretDetector.redact(msg)
  // 2. Truncate to 500 chars
  return redacted.slice(0, 500)
}
```

#### JSONL Store (store/jsonl.ts)

```typescript
class JsonlAuditStore implements AuditStore {
  private basePath: string

  async append(entry: AuditEntry): Promise<void> {
    const sanitized = sanitizeAuditEntry(entry)
    const filename = this.getDailyFilename() // audit-YYYY-MM-DD.jsonl
    const line = JSON.stringify(sanitized) + '\n'
    await fs.appendFile(path.join(this.basePath, filename), line)
  }

  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    // Scan JSONL files matching date range
    // Filter by category, action, severity, etc.
  }

  private getDailyFilename(): string {
    const date = new Date().toISOString().slice(0, 10)
    return `audit-${date}.jsonl`
  }
}
```

#### Integrity Mode (integrity.ts) - PHASE 2

```typescript
// Phase 2: Add hash chain integrity to audit entries
interface IntegrityEntry extends AuditEntry {
  prev_hash: string | null  // Hash of previous entry
  entry_hash: string        // SHA-256 of this entry
}

function computeEntryHash(entry: AuditEntry, prevHash: string | null): string {
  const canonical = JSON.stringify({
    ...entry,
    prev_hash: prevHash,
  })
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

async function verifyChain(entries: IntegrityEntry[]): Promise<VerifyResult> {
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

#### Alert Engine (alerts.ts) - PHASE 2

```typescript
// Phase 2: Add alerting with thresholds and cooldown
class AlertEngine {
  private thresholds: Map<string, AlertThreshold>
  private cooldowns: Map<string, number> // key -> last alert timestamp

  evaluate(entry: AuditEntry): AlertAction | null {
    const key = `${entry.category}:${entry.action}`
    const threshold = this.thresholds.get(key)

    if (!threshold) return null

    // Check cooldown
    const lastAlert = this.cooldowns.get(key) ?? 0
    if (Date.now() - lastAlert < threshold.cooldownMs) {
      return null // Deduplicate
    }

    // Check if threshold exceeded
    if (this.exceedsThreshold(entry, threshold)) {
      this.cooldowns.set(key, Date.now())
      return { type: threshold.alertType, entry }
    }

    return null
  }
}
```

### Tests

```
test/audit/
├── schema.test.ts             # Entry validation
├── redaction.test.ts          # NEVER_LOG enforcement
├── jsonl.test.ts              # JSONL store operations
├── integrity.test.ts          # Hash chain verification
├── alerts.test.ts             # Threshold + cooldown
└── retention.test.ts          # Cleanup by severity
```

#### Critical Test Cases

```typescript
// test/audit/redaction.test.ts
describe('sanitizeAuditEntry', () => {
  it('removes message.content', () => {
    const entry = {
      category: 'channel',
      action: 'message_received',
      metadata: { message: { content: 'secret text' } }
    }
    const sanitized = sanitizeAuditEntry(entry)
    expect(sanitized.metadata.message.content).toBeUndefined()
  })

  it('removes tool.output', () => {})
  it('sanitizes errorMessage through SecretDetector', () => {})
  it('truncates errorMessage to 500 chars', () => {})
})

// test/audit/integrity.test.ts
describe('hash chain', () => {
  it('verifies valid chain', () => {})
  it('detects tampered entry', () => {})
  it('detects missing entry', () => {})
})
```

### CLI Commands

```bash
meao audit tail [-n 50] [--category tool] [--follow]
meao audit search --action tool_denied --since 24h
meao audit export --since 7d --format jsonl > backup.jsonl
meao audit stats [--since 24h]
meao audit verify [--date 2026-01-29]  # Verify integrity
```

### Definition of Done

**MVP (must complete):**
- [ ] Error messages sanitized through SecretDetector + truncation
- [ ] NEVER_LOG test still passes (from M1.5)
- [ ] CLI `meao audit tail` command works
- [ ] All tests pass

**Phase 2 (can defer):**
- [ ] Hash chain integrity mode works
- [ ] `meao audit verify` command works
- [ ] Alert engine with cooldown/deduplication works
- [ ] Retention cleanup by severity

---

## Milestone 4: Sandbox System

**Goal:** Implement process and container isolation with network control.

**Scope:** MVP = process sandbox + container with network=none. Proxy egress is Phase 3.

**Spec Reference:** [SANDBOX.md](./SANDBOX.md)

### File Structure

```
src/sandbox/
├── index.ts                   # Public exports
├── types.ts                   # SandboxLevel, NetworkMode, ExecutionResult
├── process.ts                 # Process sandbox (no container)
├── container/
│   ├── index.ts
│   ├── docker.ts              # Docker container management
│   ├── config.ts              # Container configuration
│   └── cleanup.ts             # Container lifecycle
├── network/
│   ├── index.ts
│   ├── modes.ts               # Network mode selection
│   ├── proxy.ts               # Egress proxy server
│   └── dns.ts                 # DNS rebinding protection
├── executor.ts                # Unified execution interface
└── audit.ts                   # Sandbox audit events
```

### Key Exports

```typescript
// src/sandbox/index.ts
export { SandboxExecutor } from './executor'
export { type SandboxLevel, type NetworkMode, type ExecutionResult } from './types'
export { ProcessSandbox } from './process'
export { ContainerSandbox } from './container'
export { SandboxProxy } from './network/proxy'
```

### Implementation Requirements

#### Sandbox Levels

```typescript
type SandboxLevel = 'none' | 'process' | 'container'

// Default levels by tool (from SANDBOX.md)
const DEFAULT_SANDBOX_LEVELS: Record<string, SandboxLevel> = {
  read: 'process',
  write: 'process',
  edit: 'process',
  web_fetch: 'process',
  bash: 'container',      // Always containerized
  python: 'container',
  node: 'container',
}
```

#### Network Modes

```typescript
type NetworkMode = 'none' | 'proxy' | 'host'

// Default: none (no network)
// Proxy: Egress through allowlist-enforcing proxy
// Host: Direct network (DANGEROUS, requires approval)
```

#### Process Sandbox (process.ts)

```typescript
class ProcessSandbox {
  async execute(command: string, config: ProcessConfig): Promise<ExecutionResult> {
    // 1. Clean environment (only explicit vars)
    const env = this.buildCleanEnv(config.env)

    // 2. Validate paths
    this.validatePaths(config.allowedPaths, config.blockedPaths)

    // 3. Spawn with timeout
    const child = spawn(command, {
      env,
      cwd: config.workDir,
      timeout: config.timeout,
    })

    // 4. Capture output with size limit
    const output = await this.captureOutput(child, config.maxOutputSize)

    return {
      exitCode: child.exitCode,
      stdout: output.stdout,
      stderr: output.stderr,
      truncated: output.truncated,
    }
  }
}
```

#### Container Sandbox (container/docker.ts)

```typescript
class ContainerSandbox {
  async execute(command: string, config: ContainerConfig): Promise<ExecutionResult> {
    const args = [
      'run',
      '--rm',
      '--network=none',           // ALWAYS no network in MVP
      '--read-only',              // Read-only root filesystem
      '--cap-drop=ALL',           // Drop all capabilities
      '--user=nobody',            // Non-root user
      `--memory=${config.memory}`,
      `--cpus=${config.cpus}`,
      `--pids-limit=${config.pidsLimit}`,
      '-v', `${config.workDir}:/workspace:rw`,
      config.image,
      '/bin/sh', '-c', command,
    ]

    // MVP: bash ALWAYS runs with --network=none
    // Phase 3: Add proxy egress mode via HTTP_PROXY env var
    // (NOT via --network=container which complicates lifecycle)

    return this.runDocker(args, config.timeout)
  }
}
```

#### Network Mode Selection (network/modes.ts) - MVP SIMPLIFIED

```typescript
// MVP: bash always runs with network=none
// This function exists for future proxy mode (Phase 3)

async function selectNetworkMode(
  command: string,
  context: RequestContext,
  approvalManager: ApprovalManager
): Promise<NetworkMode> {
  // MVP: Always return 'none' for bash commands
  // Commands needing network should use web_fetch instead
  return 'none'

  // Phase 3: Implement proxy mode with HTTP_PROXY env var
  // const needsNetwork = detectNetworkNeed(command)
  // if (needsNetwork) { ... request approval ... }
}
```

#### DNS Rebinding Protection (network/dns.ts)

```typescript
async function resolveAndValidate(hostname: string): Promise<ResolveResult> {
  const addresses = await dns.resolve(hostname)

  for (const addr of addresses) {
    // Block private IPs
    if (isPrivateIP(addr)) {
      return { valid: false, reason: `Private IP: ${addr}` }
    }
    // Block metadata endpoints
    if (isMetadataIP(addr)) {
      return { valid: false, reason: `Metadata endpoint: ${addr}` }
    }
    // Block localhost
    if (isLoopback(addr)) {
      return { valid: false, reason: `Loopback: ${addr}` }
    }
  }

  return { valid: true, addresses }
}

// Re-validate on redirects
async function validateRedirect(
  originalHost: string,
  redirectHost: string
): Promise<ResolveResult> {
  // Must re-resolve and re-validate the redirect target
  return resolveAndValidate(redirectHost)
}
```

### Tests

```
test/sandbox/
├── process.test.ts            # Process sandbox
├── container.test.ts          # Container sandbox (integration-only)
├── network/
│   ├── modes.test.ts          # Network mode selection
│   ├── proxy.test.ts          # Proxy allowlist
│   └── dns.test.ts            # DNS rebinding protection
└── integration.test.ts        # End-to-end sandbox tests (integration-only)
```

**CI Environment Note:**

Container tests are painful in CI unless Docker is explicitly configured. For MVP:

```typescript
// test/sandbox/container.test.ts
describe.skipIf(!isDockerAvailable())('ContainerSandbox', () => {
  // Tests only run when Docker is available
})

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
```

- Mark container tests as **integration-only** (run with `pnpm test:integration`)
- Skip if `docker info` fails (no Docker daemon)
- Keep process sandbox tests as the main CI gate early
- Container tests run in dedicated CI job with Docker-in-Docker

#### Critical Test Cases

```typescript
// test/sandbox/container.test.ts
describe('ContainerSandbox', () => {
  it('defaults to network=none', () => {})
  it('drops all capabilities', () => {})
  it('runs as non-root user', () => {})
  it('enforces memory limit', () => {})
  it('enforces timeout', () => {})
})

// test/sandbox/network/dns.test.ts
describe('DNS rebinding protection', () => {
  // IPv4
  it('blocks private IPs (10.x.x.x)', () => {})
  it('blocks private IPs (172.16-31.x.x)', () => {})
  it('blocks private IPs (192.168.x.x)', () => {})
  it('blocks metadata endpoint (169.254.169.254)', () => {})
  it('blocks localhost (127.0.0.1)', () => {})

  // IPv6 (AAAA records)
  it('blocks IPv6 loopback (::1)', () => {})
  it('blocks IPv6 ULA (fc00::/7)', () => {})
  it('blocks IPv6 link-local (fe80::/10)', () => {})

  // Edge cases
  it('re-validates on redirect', () => {})
  it('handles mixed A and AAAA responses', () => {})
})
```

### Definition of Done

**MVP (must complete):**
- [ ] Process sandbox enforces clean env, paths, timeout
- [ ] Container sandbox ALWAYS uses `--network=none`
- [ ] Container sandbox applies all hardening (cap-drop, non-root, read-only)
- [ ] DNS rebinding protection blocks private/metadata IPs (for web_fetch)
- [ ] Audit events emitted for sandbox operations
- [ ] All tests pass

**Phase 3 (defer):**
- [ ] Proxy egress mode via HTTP_PROXY
- [ ] Network mode upgrade with approval flow

---

## Milestone 5: Tool System

**Goal:** Implement tool registry, capability enforcement, and builtin tools.

**Spec Reference:** [TOOL_CAPABILITY.md](./TOOL_CAPABILITY.md)

### File Structure

```
src/tools/
├── index.ts                   # Public exports
├── types.ts                   # ToolPlugin, ToolContext, ToolResult
├── registry.ts                # ToolRegistry class
├── capability.ts              # Capability schema + helpers
├── approvals.ts               # ApprovalManager
├── executor.ts                # ToolExecutor (the enforcement pipeline)
├── audit.ts                   # Tool audit events
└── builtin/
    ├── index.ts               # Register all builtins
    ├── read.ts                # File read tool (MVP)
    ├── write.ts               # File write tool (MVP)
    ├── edit.ts                # File edit tool (PHASE 2 - not in MVP DoD)
    ├── bash.ts                # Shell execution tool (MVP)
    └── web_fetch.ts           # HTTP fetch tool (MVP)
```

### Key Exports

```typescript
// src/tools/index.ts
export { ToolRegistry } from './registry'
export { ToolExecutor } from './executor'
export { ApprovalManager } from './approvals'
export { type ToolPlugin, type ToolContext, type ToolResult } from './types'
export { registerBuiltinTools } from './builtin'
```

### Implementation Requirements

#### Tool Plugin Interface

```typescript
interface ToolPlugin {
  name: string
  description: string
  parameters: z.ZodSchema          // Zod schema for arguments
  capability: ToolCapability       // Security policy
  execute(args: unknown, context: ToolContext): Promise<ToolOutput>
}

interface ToolContext {
  requestId: string
  sessionId: string
  workDir: string
  approvals: string[]              // Already-granted approvals
  sandbox: SandboxExecutor
  audit: AuditLogger
}

interface ToolResult {
  success: boolean
  output: string                   // Sanitized output
  label: ContentLabel              // Trust + data class
  truncated: boolean
  executionTime: number
}
```

#### Canonical ToolAction Format (types.ts)

Tools must declare their actions in a machine-readable format for consistent autonomy/approval checks.

```typescript
/**
 * Canonical action naming prevents brittle string matching in autonomy rules.
 * Format: <tool>:<action> or <tool>:<category>:<action>
 *
 * Examples:
 *   gmail:read          - Read emails
 *   gmail:send          - Send email to others
 *   home_assistant:lights:on
 *   home_assistant:lock:unlock
 *   calendar:read
 *   calendar:create
 *   calendar:delete
 */
interface ToolAction {
  tool: string                    // Tool name (e.g., 'gmail', 'home_assistant')
  action: string                  // Action name (e.g., 'read', 'send', 'unlock')
  category?: string               // Optional sub-category (e.g., 'lights', 'lock')
  affectsOthers: boolean          // Does this action affect people other than owner?
  isDestructive: boolean          // Is this hard to undo?
  hasFinancialImpact: boolean     // Does this involve money?
}

// Every tool must declare its actions
interface ToolPlugin {
  name: string
  description: string
  parameters: z.ZodSchema
  capability: ToolCapability

  // NEW: Declare all actions this tool can perform
  actions: ToolAction[]

  execute(args: unknown, context: ToolContext): Promise<ToolOutput>
}

// Helper to build canonical action string
function formatAction(action: ToolAction): string {
  if (action.category) {
    return `${action.tool}:${action.category}:${action.action}`
  }
  return `${action.tool}:${action.action}`
}

// Helper to check if action matches a pattern (supports wildcards)
function matchesActionPattern(action: string, pattern: string): boolean {
  // Exact match
  if (action === pattern) return true

  // Wildcard match: 'gmail:*' matches 'gmail:read', 'gmail:send'
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1)  // 'gmail:'
    return action.startsWith(prefix)
  }

  return false
}

// Example: Gmail tool declares its actions
const gmailTool: ToolPlugin = {
  name: 'gmail',
  actions: [
    { tool: 'gmail', action: 'read', affectsOthers: false, isDestructive: false, hasFinancialImpact: false },
    { tool: 'gmail', action: 'send', affectsOthers: true, isDestructive: false, hasFinancialImpact: false },
    { tool: 'gmail', action: 'delete', affectsOthers: false, isDestructive: true, hasFinancialImpact: false },
  ],
  // ...
}
```

#### Tool Executor Pipeline (executor.ts)

**Approval ID Canonical Format:**

Approval IDs must be stable and canonical so they work across retries:

```typescript
// Format: tool:method:normalized_target
// Examples:
//   web_fetch:GET:www.npmjs.com/package/lodash
//   bash:execute:npm_install
//   gmail:send:recipient@example.com

function computeApprovalId(tool: string, action: string, target: string): string {
  // Normalize URL: lowercase host, remove trailing slash, keep path
  // Normalize command: first word or hash of full command
  const normalized = normalizeTarget(target)
  return `${tool}:${action}:${normalized}`
}
```

**Output Truncation Rule:**

```typescript
// Truncation happens AFTER redaction, is deterministic per capability
const OUTPUT_CAPS: Record<string, number> = {
  web_fetch: 50_000,   // 50KB (HTML already extracted)
  bash: 100_000,       // 100KB (command output)
  read: 200_000,       // 200KB (file contents)
  default: 50_000,     // 50KB default
}

function truncateOutput(output: string, capability: ToolCapability): string {
  const cap = OUTPUT_CAPS[capability.name] ?? OUTPUT_CAPS.default
  if (output.length <= cap) return output
  return output.slice(0, cap) + `\n[TRUNCATED: ${output.length - cap} bytes omitted]`
}
```

```typescript
// Approval helpers (prevent duplicate approvals in array)
function hasApproval(context: ToolContext, approvalId: string): boolean {
  return context.approvals.includes(approvalId)
}

function addApproval(context: ToolContext, approvalId: string): void {
  if (!hasApproval(context, approvalId)) {
    context.approvals.push(approvalId)
  }
}

class ToolExecutor {
  async execute(
    tool: ToolPlugin,
    args: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    // 1. Validate arguments
    const validatedArgs = tool.parameters.parse(args)

    // 2. Compute required approvals
    const requiredApprovals = this.computeApprovals(tool, validatedArgs)

    // 3. Request any missing approvals (using helpers to prevent duplicates)
    for (const approval of requiredApprovals) {
      if (!hasApproval(context, approval.id)) {
        const granted = await this.approvalManager.request(approval, context)
        if (!granted) {
          await this.auditDenied(tool, validatedArgs, approval, context)
          return { success: false, output: 'Approval denied', ... }
        }
        addApproval(context, approval.id)  // Use helper, not direct push
      }
    }

    // 4. Enforce network rules (for web_fetch)
    if (tool.capability.network) {
      const networkResult = await this.enforceNetwork(tool, validatedArgs)
      if (!networkResult.allowed) {
        return { success: false, output: networkResult.reason, ... }
      }
    }

    // 5. Execute - tool.execute() does the work
    //    Tools that need sandbox (bash/python/node) use context.sandbox internally
    const startTime = Date.now()
    const rawOutput = await tool.execute(validatedArgs, context)

    // 6. Sanitize output (secretDetector is singleton, see Security Primitives)
    const { redacted, findings } = secretDetector.redact(rawOutput.output)

    // 7. Truncate output (centralized, deterministic per capability)
    // RULE: Truncation happens AFTER redaction, uses capability-specific cap
    const sanitizedOutput = this.truncateOutput(redacted, tool.capability)

    // 8. Apply labels
    const label = labelOutput(tool.capability, findings)

    // 9. Emit audit event
    await this.auditExecution(tool, validatedArgs, context, {
      success: rawOutput.success,
      executionTime: Date.now() - startTime,
      secretsFound: findings.length,
      // Note: output NOT logged per AUDIT.md
    })

    return {
      success: rawOutput.success,
      output: sanitizedOutput,
      label,
      truncated: sanitizedOutput.length < redacted.length,
      executionTime: Date.now() - startTime,
    }
  }
}
```

#### web_fetch Implementation (builtin/web_fetch.ts)

**HTML Handling Policy:**

1. **Content-Type detection**: Check response headers
2. **HTML extraction**: Strip to `<main>` or `<body>`, remove scripts/styles
3. **Text conversion**: Convert HTML entities, preserve links as markdown
4. **Size cap**: Truncate to 50KB after extraction (before sending to provider)
5. **JSON passthrough**: Return JSON as-is (no extraction needed)

```typescript
const webFetchTool: ToolPlugin = {
  name: 'web_fetch',
  description: 'Fetch content from a URL',
  parameters: z.object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
  capability: {
    approval: {
      level: 'auto',  // For GET to known hosts
      conditions: {
        // Non-GET requires approval
        methodRequiresApproval: ['POST', 'PUT', 'DELETE'],
        // Unknown hosts require approval
        unknownHostRequiresApproval: true,
      },
    },
    network: {
      mode: 'allowlist',
      // Include both .com and .org for npm (golden path uses www.npmjs.com)
      // Also include githubusercontent for redirects/assets
      allowedHosts: [
        '*.github.com',
        '*.githubusercontent.com', // GitHub raw content, avatars, assets
        'raw.githubusercontent.com',
        '*.npmjs.com',           // www.npmjs.com (golden path)
        '*.npmjs.org',           // registry.npmjs.org
        '*.stackoverflow.com',
      ],
      blockedPorts: [22, 23, 25, 3389],
      blockPrivateIPs: true,
      blockMetadataEndpoints: true,
    },
    labels: {
      outputTrust: 'untrusted',    // External content is untrusted
      outputDataClass: 'internal',
      acceptsUntrusted: false,
    },
    audit: {
      logArgs: true,
      logOutput: false,            // NEVER log page content
    },
  },
  async execute(args, context) {
    // Implementation with DNS rebinding protection
  },
}
```

#### bash Implementation (builtin/bash.ts)

```typescript
const bashTool: ToolPlugin = {
  name: 'bash',
  description: 'Execute shell commands',
  parameters: z.object({
    command: z.string(),
    workDir: z.string().optional(),
    timeout: z.number().optional(),
  }),
  capability: {
    approval: {
      level: 'ask',  // Always ask
      dangerPatterns: [
        /rm\s+-rf/,
        />\s*\/dev\/sd/,
        /mkfs/,
        /dd\s+if=/,
      ],
    },
    execution: {
      sandbox: 'container',        // Always containerized
      networkDefault: 'none',      // No network (MVP: always none)
    },
    labels: {
      // 'user' not 'verified': bash output can contain untrusted content
      // (e.g., cat of web-fetched file, user-provided input, decoded data)
      // Flow control relies on dataClass to prevent leaks, not trustLevel
      //
      // POLICY TREATMENT: trustLevel=user means "originating from user's environment"
      // Policy engine MUST NOT treat 'user' as safe for egress to sensitive destinations
      // Only 'verified' content can be sent to external services without approval
      outputTrust: 'user',
      outputDataClass: 'internal',
    },
    audit: {
      logArgs: true,               // Log command
      logOutput: false,            // Don't log output
    },
  },
  async execute(args: BashArgs, context: ToolContext): Promise<ToolOutput> {
    // bash uses context.sandbox to run in container
    // ToolExecutor handles: approvals, output sanitization, labels, audit
    return context.sandbox.runContainer({
      command: args.command,
      workDir: args.workDir ?? context.workDir,
      timeout: args.timeout ?? 120000,
      networkMode: 'none',  // MVP: always no network
    })
  },
}
```

### Tests

```
test/tools/
├── registry.test.ts           # Tool registration
├── executor.test.ts           # Execution pipeline
├── approvals.test.ts          # Approval flow
├── builtin/
│   ├── read.test.ts
│   ├── write.test.ts
│   ├── bash.test.ts
│   └── web_fetch.test.ts
└── integration.test.ts        # End-to-end tool tests
```

#### Critical Test Cases

```typescript
// test/tools/builtin/web_fetch.test.ts
describe('web_fetch', () => {
  it('auto-approves GET to known host', () => {})
  it('requires approval for POST', () => {})
  it('requires approval for unknown host', () => {})
  it('blocks private IPs', () => {})
  it('blocks metadata endpoints', () => {})
  it('labels output as untrusted', () => {})
  it('does not log page content', () => {})
})

// test/tools/builtin/bash.test.ts
describe('bash', () => {
  it('always runs in container', () => {})
  it('defaults to network=none', () => {})
  it('requires approval for dangerous patterns', () => {})
  it('does not log command output', () => {})
})

// test/tools/executor.test.ts
describe('ToolExecutor', () => {
  it('validates arguments against schema', () => {})
  it('sanitizes output through SecretDetector', () => {})
  it('applies correct labels', () => {})
  it('emits audit event without content', () => {})
})
```

### Definition of Done

- [ ] ToolRegistry can register and lookup tools
- [ ] ToolExecutor implements full enforcement pipeline
- [ ] ApprovalManager handles approval requests
- [ ] web_fetch: allowlist mode, non-GET approval, unknown host approval
- [ ] web_fetch: output labeled as untrusted, content not logged
- [ ] bash: always containerized, network=none default
- [ ] All tools emit audit events without content
- [ ] All tests pass

---

## Milestone 6: CLI Channel

**Goal:** Build the first user interface with approval prompts and streaming.

**Spec Reference:** [API.md](./API.md) (channel interface)

### File Structure

```
src/channels/
├── index.ts                   # Public exports
├── types.ts                   # Channel interface
├── cli/
│   ├── index.ts               # CLI channel implementation
│   ├── repl.ts                # Interactive REPL loop
│   ├── render.ts              # Output rendering + streaming
│   ├── approval.ts            # Approval prompts
│   ├── context.ts             # RequestContext builder
│   └── commands.ts            # Built-in CLI commands
└── base.ts                    # Base channel class
```

### Key Exports

```typescript
// src/channels/index.ts
export { type Channel, type ChannelMessage, type ChannelResponse } from './types'
export { CLIChannel } from './cli'
```

### Implementation Requirements

#### Channel Interface

```typescript
interface Channel {
  name: string
  initialize(): Promise<void>
  shutdown(): Promise<void>

  // Message handling
  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse>): void

  // Approval prompts
  requestApproval(request: ApprovalRequest): Promise<boolean>

  // Streaming
  streamDelta(delta: string): void
  streamComplete(): void

  // Optional hooks for tool execution rendering
  // Orchestrator calls these if defined; channels implement for UX
  onToolCallStart?(name: string, summary?: string): void
  onToolCallResult?(name: string, success: boolean): void
}

interface ChannelMessage {
  id: string
  userId: string
  content: string
  attachments?: Attachment[]
  timestamp: Date
}
```

#### CLI REPL (cli/repl.ts)

```typescript
class CLIRepl {
  private rl: readline.Interface
  private ownerId: string  // Real UUID, not 'owner' string

  constructor(config: CLIConfig) {
    // Get owner ID from config (created on first run)
    // This is a real UUID with role=owner in the user profile
    this.ownerId = config.ownerId
  }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'meao> ',
    })

    this.rl.prompt()

    for await (const line of this.rl) {
      if (line.startsWith('/')) {
        await this.handleCommand(line)
      } else {
        await this.handleMessage(line)
      }
      this.rl.prompt()
    }
  }

  private async handleMessage(content: string): Promise<void> {
    const context = this.buildContext()
    const response = await this.messageHandler({
      id: crypto.randomUUID(),
      userId: this.ownerId,  // Real UUID, use isOwner(userId) to check
      content,
      timestamp: new Date(),
    })
    // Response streamed via streamDelta()
  }
}

// On first run, create owner user with real UUID
async function initializeOwner(config: AppConfig): Promise<string> {
  const existingOwnerId = await storage.getOwnerId()
  if (existingOwnerId) return existingOwnerId

  // Create new owner with real UUID
  const ownerId = crypto.randomUUID()
  await storage.createUser({
    id: ownerId,
    role: 'owner',  // Role determines permissions, not special ID
    displayName: config.owner.displayName,
    createdAt: new Date(),
  })

  return ownerId
}
```
```

#### Approval Prompts (cli/approval.ts)

```typescript
async function promptApproval(request: ApprovalRequest): Promise<boolean> {
  console.log('\n' + chalk.yellow('Approval Required'))
  console.log(chalk.dim('─'.repeat(50)))
  console.log(`Tool: ${chalk.cyan(request.tool)}`)
  console.log(`Action: ${request.summary}`)

  if (request.risks.length > 0) {
    console.log(chalk.red('\nRisks:'))
    for (const risk of request.risks) {
      console.log(`  • ${risk}`)
    }
  }

  console.log(chalk.dim('─'.repeat(50)))

  const answer = await question('Allow? [y/N/details] ')

  if (answer.toLowerCase() === 'details') {
    console.log('\nFull details:')
    console.log(JSON.stringify(request.details, null, 2))
    return promptApproval(request)  // Re-prompt
  }

  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
}
```

#### Streaming Render (cli/render.ts)

```typescript
class StreamRenderer {
  private currentLine = ''

  streamDelta(delta: string): void {
    // Handle streaming tokens
    process.stdout.write(delta)
    this.currentLine += delta

    // Handle newlines
    if (delta.includes('\n')) {
      this.currentLine = delta.split('\n').pop() ?? ''
    }
  }

  streamComplete(): void {
    if (this.currentLine) {
      process.stdout.write('\n')
    }
    this.currentLine = ''
  }

  // Implement optional Channel hooks
  onToolCallStart(name: string, summary?: string): void {
    console.log(chalk.dim(`\n[Calling ${name}...]`))
  }

  onToolCallResult(name: string, success: boolean): void {
    const icon = success ? chalk.green('✓') : chalk.red('✗')
    console.log(chalk.dim(`[${icon} ${name} complete]`))
  }
}
```

### Tests

```
test/channels/cli/
├── repl.test.ts               # REPL loop
├── approval.test.ts           # Approval prompts
├── render.test.ts             # Streaming render
└── commands.test.ts           # Built-in commands
```

### Definition of Done

- [ ] CLI REPL accepts input and displays responses
- [ ] Streaming tokens render incrementally
- [ ] Approval prompts show tool, action, risks
- [ ] Approval prompts support [y/N/details]
- [ ] Built-in commands work (/help, /quit, /clear)
- [ ] RequestContext properly built for each message
- [ ] All tests pass

---

## Milestone 7: Provider Adapter

**Goal:** Implement AI provider abstraction with tool calling support.

**Scope:** MVP = MockProvider + Anthropic. OpenAI/Ollama are Phase 2.

**Strategy:** Build MockProvider FIRST to enable testing the orchestrator and tools without real LLM integration. Then add Anthropic once the rest works.

**Spec Reference:** [INTERFACES.md](./INTERFACES.md) (provider types)

### File Structure

```
src/provider/
├── index.ts                   # Public exports
├── types.ts                   # ProviderClient, ChatRequest, ChatResponse
├── adapter.ts                 # Provider adapter (factory)
├── mock.ts                    # MockProvider for testing (MVP first!)
├── anthropic.ts               # Anthropic implementation (MVP)
├── openai.ts                  # OpenAI implementation (Phase 2)
├── ollama.ts                  # Ollama implementation (Phase 2)
├── streaming.ts               # Stream handling utilities
└── tools.ts                   # Tool call parsing + formatting
```

### Key Exports

```typescript
// src/provider/index.ts
export { createProvider, type ProviderClient } from './adapter'
export { MockProvider } from './mock'  // For testing
export { type ChatRequest, type ChatResponse, type ToolCall } from './types'
```

### Implementation Requirements

#### MockProvider (mock.ts) - BUILD THIS FIRST

```typescript
// MockProvider enables testing orchestrator + tools without real LLM
class MockProvider implements ProviderClient {
  private scenarios: Map<string, MockScenario> = new Map()

  // Add test scenarios
  addScenario(trigger: string, response: MockResponse): void {
    this.scenarios.set(trigger, response)
  }

  async *streamMessage(request: ChatRequest): AsyncIterable<StreamEvent> {
    const lastMessage = request.messages[request.messages.length - 1]

    // Check for matching scenario
    for (const [trigger, scenario] of this.scenarios) {
      if (lastMessage.content.includes(trigger)) {
        yield* this.executeScenario(scenario)
        return
      }
    }

    // Default: echo back
    yield { type: 'text_delta', delta: `Echo: ${lastMessage.content}` }
    yield { type: 'complete', response: { content: `Echo: ${lastMessage.content}`, ... } }
  }

  // Golden path scenario for testing
  static goldenPath(): MockProvider {
    const provider = new MockProvider()

    // "Fetch npm docs" triggers web_fetch tool call
    provider.addScenario('npm', {
      toolCalls: [{
        id: 'call_1',
        name: 'web_fetch',
        arguments: { url: 'https://www.npmjs.com/package/lodash', method: 'GET' },
      }],
      afterToolResult: 'Here is the documentation for lodash...',
    })

    return provider
  }
}
```

#### Provider Interface

```typescript
interface ProviderClient {
  sendMessage(request: ChatRequest): Promise<ChatResponse>
  streamMessage(request: ChatRequest): AsyncIterable<StreamEvent>
}

interface ChatRequest {
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
}

interface ChatResponse {
  content: string
  toolCalls?: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
}

type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; delta: string }  // JSON chunks
  | { type: 'tool_call_end'; id: string }  // Orchestrator buffers deltas, parses on end
  | { type: 'complete'; response: ChatResponse }

// NOTE: tool_call_delta streams JSON argument chunks
// Orchestrator must buffer these and parse on tool_call_end
// See Orchestrator section for buffering implementation
```

#### Anthropic Implementation (anthropic.ts)

```typescript
class AnthropicProvider implements ProviderClient {
  private client: Anthropic

  constructor(config: AnthropicConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
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
    const stream = await this.client.messages.stream({
      model: this.config.model,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      messages: this.formatMessages(request.messages),
      tools: request.tools ? this.formatTools(request.tools) : undefined,
    })

    for await (const event of stream) {
      yield this.parseStreamEvent(event)
    }
  }
}
```

### Tests

```
test/provider/
├── anthropic.test.ts          # Anthropic provider
├── streaming.test.ts          # Stream handling
└── tools.test.ts              # Tool call parsing
```

### Definition of Done

**MVP (must complete):**
- [ ] MockProvider works for golden path testing
- [ ] MockProvider.goldenPath() triggers web_fetch scenario
- [ ] Anthropic provider works with tool calling
- [ ] Streaming works and emits proper events
- [ ] Tool calls parsed correctly
- [ ] All tests pass

**Phase 2 (defer):**
- [ ] OpenAI provider
- [ ] Ollama provider
- [ ] Provider failover

---

## Milestone 8: Orchestrator

**Goal:** Implement the message routing loop that ties everything together.

**Spec Reference:** [ARCHITECTURE.md](./ARCHITECTURE.md) (orchestrator role)

### File Structure

```
src/orchestrator/
├── index.ts                   # Public exports
├── types.ts                   # Orchestrator types
├── core.ts                    # Main orchestrator loop
├── context.ts                 # Context builder
├── router.ts                  # Skill/tool routing (minimal first)
└── events.ts                  # Orchestrator events
```

### Key Exports

```typescript
// src/orchestrator/index.ts
export { Orchestrator } from './core'
export { type OrchestratorEvent, type OrchestratorConfig } from './types'
```

### Implementation Requirements

#### Orchestrator Loop (core.ts)

**CRITICAL:** Cannot reassign stream inside `for await` loop. Use outer while loop.

```typescript
class Orchestrator {
  async handleMessage(
    message: ChannelMessage,
    channel: Channel,
    session: Session
  ): Promise<void> {
    const context = await this.buildContext(message, session)
    const executedToolResults: Message[] = []  // Track for history

    // OUTER LOOP: Restart stream after tool execution
    while (true) {
      const toolCallBuffers = new Map<string, { name: string; chunks: string[] }>()
      let needsRestart = false
      let finalResponse: ChatResponse | null = null

      const stream = this.provider.streamMessage({
        messages: context.messages,
        tools: this.getAvailableToolDefinitions(),  // Uses zodToJsonSchema()
      })

      // INNER LOOP: Consume current stream
      for await (const event of stream) {
        switch (event.type) {
          case 'text_delta':
            channel.streamDelta(event.delta)
            break

          case 'tool_call_start':
            toolCallBuffers.set(event.id, { name: event.name, chunks: [] })
            channel.onToolCallStart?.(event.name)
            break

          case 'tool_call_delta':
            const buffer = toolCallBuffers.get(event.id)
            if (buffer) buffer.chunks.push(event.delta)
            break

          case 'tool_call_end':
            const callBuffer = toolCallBuffers.get(event.id)
            if (!callBuffer) throw new Error(`Unknown tool call: ${event.id}`)

            const args = JSON.parse(callBuffer.chunks.join(''))
            const tool = this.toolRegistry.get(callBuffer.name)
            const result = await this.toolExecutor.execute(tool, args, context)

            channel.onToolCallResult?.(callBuffer.name, result.success)
            const toolResult = { role: 'tool_result', toolCallId: event.id, content: result.output }
            context.messages.push(toolResult)
            executedToolResults.push(toolResult)  // Track for session history

            toolCallBuffers.delete(event.id)
            needsRestart = true
            // NOTE: Do NOT call channel.streamComplete() here - that's only for final response
            // Channel can optionally show "[calling tool...]" via onToolCallStart hook
            break  // CRITICAL: Exit inner loop immediately

          case 'complete':
            // Stream finished - capture final response for history and audit
            finalResponse = event.response
            break
        }
        if (needsRestart) break  // Must restart - provider hasn't seen tool result
      }

      if (needsRestart) continue  // Restart stream with tool result

      // Done - update session history
      if (finalResponse) {
        channel.streamComplete()
        // 1. User message
        this.sessionManager.addToHistory(session.id, { role: 'user', content: message.content })
        // 2. Tool results
        for (const tr of executedToolResults) this.sessionManager.addToHistory(session.id, tr)
        // 3. Assistant (use finalResponse.content, not streamed deltas - avoids duplication)
        if (finalResponse.content)
          this.sessionManager.addToHistory(session.id, { role: 'assistant', content: finalResponse.content })
        await this.auditConversation(context, finalResponse)
      }
      break
    }
  }
}
```

#### Context Builder (context.ts)

```typescript
async function buildContext(
  message: ChannelMessage,
  session: Session
): Promise<RequestContext> {
  return {
    requestId: crypto.randomUUID(),
    sessionId: session.id,
    userId: message.userId,
    channel: session.channel,
    workDir: session.workDir,
    approvals: [],
    messages: [
      ...session.history,  // Working memory
      { role: 'user', content: message.content },
    ],
    startTime: new Date(),
  }
}
```

### Tests

```
test/orchestrator/
├── core.test.ts               # Orchestrator loop
├── context.test.ts            # Context building
└── golden_path.test.ts        # End-to-end integration
```

#### Golden Path Test

```typescript
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
    }, channel)

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
})
```

### Definition of Done

- [ ] Orchestrator handles message → provider → tools → response flow
- [ ] Tool calls executed through ToolExecutor
- [ ] Streaming works end-to-end
- [ ] Context properly built with working memory
- [ ] Audit events emitted throughout
- [ ] Golden path test passes
- [ ] All tests pass

---

## Milestone 9: Gateway (HTTP + WebSocket)

**Goal:** Implement the HTTP/WebSocket API for non-CLI clients.

**Spec Reference:** [API.md](./API.md)

### File Structure

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

### Definition of Done

- [ ] HTTP server starts and responds to health checks
- [ ] REST endpoints match API.md specification
- [ ] WebSocket streaming works
- [ ] Device pairing flow works
- [ ] Rate limiting enforced
- [ ] Request ID correlation throughout
- [ ] All tests pass

---

## Milestone 10: Memory System

**Goal:** Implement three-tier memory (working, episodic, semantic) with visibility controls for multi-user privacy.

**Spec Reference:** [MEMORY.md](./MEMORY.md)

### File Structure

```
src/memory/
├── index.ts                   # Public exports
├── types.ts                   # Memory types + visibility
├── visibility.ts              # Access control for memories
├── working/
│   └── index.ts               # Session-scoped memory
├── episodic/
│   ├── index.ts               # Vector similarity search
│   ├── embeddings.ts          # Embedding generation
│   └── store.ts               # Vector store (sqlite-vss first)
├── semantic/
│   ├── index.ts               # Structured knowledge
│   ├── types.ts               # Fact, preference, entity types
│   └── store.ts               # Semantic store
└── manager.ts                 # Unified memory manager
```

### Key Exports

```typescript
// src/memory/index.ts
export { MemoryManager } from './manager'
export { EpisodicMemory } from './episodic'
export { SemanticMemory } from './semantic'
export { type MemoryEntry, type MemoryVisibility, type MemoryQuery } from './types'
export { checkVisibility } from './visibility'
```

### Implementation Requirements

#### Memory Types with Visibility (types.ts)

```typescript
/**
 * Memory visibility controls who can access a memory item.
 * This is critical for multi-user privacy (e.g., family assistant).
 *
 * - 'owner': Only the owner can see this memory
 * - 'family': All family members can see this memory
 * - 'user:<id>': Only specific user can see this memory
 * - 'agent': Only the agent can see (internal memories)
 */
type MemoryVisibility = 'owner' | 'family' | `user:${string}` | 'agent'

interface MemoryEntry {
  id: string
  namespace: string              // Agent namespace (e.g., 'doris')
  category: MemoryCategory       // identity, family, preference, etc.

  content: string
  embedding?: number[]           // Vector embedding for similarity search

  // Visibility & access control
  visibility: MemoryVisibility   // Who can access this memory
  createdBy: string              // User ID who created this memory
  subjects: string[]             // User IDs this memory is about

  // Metadata
  confidence: 'high' | 'medium' | 'low'
  source: 'explicit' | 'extraction' | 'system'
  sourceConversationId?: string

  // Timestamps
  createdAt: Date
  lastAccessedAt: Date
  expiresAt?: Date               // Optional auto-expiry
}

type MemoryCategory =
  | 'identity'      // Core facts: names, relationships, ages, birthdays
  | 'family'        // Family members, schools, activities
  | 'preference'    // How user likes things done
  | 'project'       // Things user is working on
  | 'decision'      // Architectural choices, past decisions
  | 'context'       // Recurring themes, background info
  | 'health'        // Health-related (sensitive)
  | 'financial'     // Financial info (sensitive)

interface MemoryQuery {
  namespace: string
  category?: MemoryCategory
  visibility?: MemoryVisibility  // Filter by visibility
  requesterId: string            // Who is requesting (for access check)
  text?: string                  // Semantic search query
  limit?: number
  sortBy?: 'relevance' | 'recency'
}
```

#### Visibility Enforcement (visibility.ts)

```typescript
/**
 * Check if a requester can access a memory item.
 * This is enforced on every memory read operation.
 */
function checkVisibility(
  memory: MemoryEntry,
  requesterId: string,
  requesterRole: 'owner' | 'family' | 'user'
): boolean {
  switch (memory.visibility) {
    case 'owner':
      // Only owner can access
      return requesterRole === 'owner'

    case 'family':
      // Owner or family members
      return requesterRole === 'owner' || requesterRole === 'family'

    case 'agent':
      // Agent-internal, no user can directly access
      return false

    default:
      // 'user:<id>' - check specific user
      if (memory.visibility.startsWith('user:')) {
        const allowedUserId = memory.visibility.slice(5)
        return requesterId === allowedUserId
      }
      return false
  }
}

/**
 * Filter memories by visibility.
 * Used in all query operations.
 */
function filterByVisibility(
  memories: MemoryEntry[],
  requesterId: string,
  requesterRole: 'owner' | 'family' | 'user'
): MemoryEntry[] {
  return memories.filter(m => checkVisibility(m, requesterId, requesterRole))
}

/**
 * Determine default visibility for a new memory.
 */
function getDefaultVisibility(
  category: MemoryCategory,
  createdBy: string,
  subjects: string[]
): MemoryVisibility {
  // Sensitive categories default to owner-only
  if (category === 'health' || category === 'financial') {
    return 'owner'
  }

  // If memory is about a specific person (not owner), restrict to them
  if (subjects.length === 1 && subjects[0] !== createdBy) {
    return `user:${subjects[0]}`
  }

  // Family-wide information
  if (category === 'family') {
    return 'family'
  }

  // Default to owner-only (safe default)
  return 'owner'
}
```

#### Memory Manager (manager.ts)

```typescript
class MemoryManager {
  constructor(
    private episodic: EpisodicMemory,
    private semantic: SemanticMemory
  ) {}

  /**
   * Store a memory with automatic visibility assignment.
   * Visibility is optional - defaults based on category and creator.
   */
  async store(
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'> & { visibility?: MemoryVisibility }
  ): Promise<string> {
    const visibility = entry.visibility ?? getDefaultVisibility(
      entry.category,
      entry.createdBy,
      entry.subjects
    )

    const fullEntry: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      visibility,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }

    // Store in appropriate tier
    if (entry.category === 'identity' || entry.category === 'preference') {
      await this.semantic.store(fullEntry)
    } else {
      await this.episodic.add(fullEntry)  // Note: add() not store()
    }

    return fullEntry.id
  }

  /**
   * Query memories with visibility enforcement.
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const requesterRole = await this.getRequesterRole(query.requesterId)

    // Query from appropriate tier
    let results: MemoryEntry[]
    if (query.text) {
      results = await this.episodic.search(query.text, query.limit ?? 20)
    } else {
      results = await this.semantic.query(query)
    }

    // CRITICAL: Filter by visibility
    return filterByVisibility(results, query.requesterId, requesterRole)
  }
}
```

### Tests

```
test/memory/
├── types.test.ts              # Memory entry validation
├── visibility.test.ts         # Visibility enforcement
├── episodic.test.ts           # Vector search
├── semantic.test.ts           # Structured storage
└── manager.test.ts            # Unified manager
```

#### Critical Test Cases

```typescript
describe('Memory Visibility', () => {
  it('owner can access owner-only memories', () => {
    const memory = createMemory({ visibility: 'owner' })
    expect(checkVisibility(memory, 'owner-id', 'owner')).toBe(true)
  })

  it('family member cannot access owner-only memories', () => {
    const memory = createMemory({ visibility: 'owner' })
    expect(checkVisibility(memory, 'family-member-id', 'family')).toBe(false)
  })

  it('user can access their own user-specific memories', () => {
    const memory = createMemory({ visibility: 'user:child-123' })
    expect(checkVisibility(memory, 'child-123', 'user')).toBe(true)
  })

  it('user cannot access other user-specific memories', () => {
    const memory = createMemory({ visibility: 'user:child-123' })
    expect(checkVisibility(memory, 'child-456', 'user')).toBe(false)
  })

  it('sensitive categories default to owner-only', () => {
    const visibility = getDefaultVisibility('health', 'owner', [])
    expect(visibility).toBe('owner')
  })
})

describe('MemoryManager', () => {
  it('filters query results by visibility', async () => {
    const manager = createTestMemoryManager()

    // Store memories with different visibility
    await manager.store({ category: 'family', visibility: 'family', ... })
    await manager.store({ category: 'health', visibility: 'owner', ... })

    // Query as family member
    const results = await manager.query({ requesterId: 'family-member', ... })

    // Should only see family-visible memories
    expect(results.every(m => m.visibility === 'family')).toBe(true)
  })
})
```

### Definition of Done

- [ ] Working memory tracks conversation history
- [ ] Episodic memory stores/retrieves by similarity (using `add()` method)
- [ ] Semantic memory stores structured facts
- [ ] **Memory visibility field implemented (owner/family/user/agent)**
- [ ] **Visibility enforced on all query operations**
- [ ] **Default visibility assigned based on category and subjects**
- [ ] Memory write rules from MEMORY.md enforced
- [ ] Untrusted content cannot write to semantic memory directly
- [ ] All tests pass

---

## Milestone 11: Telegram Channel

**Goal:** Implement Telegram as the second channel.

### File Structure

```
src/channels/telegram/
├── index.ts                   # Telegram channel implementation
├── bot.ts                     # Bot setup (polling/webhook)
├── handlers.ts                # Message/command handlers
├── approval.ts                # Approval via Telegram UI
└── media.ts                   # Attachment handling
```

### Definition of Done

- [ ] Telegram bot connects and receives messages
- [ ] Responses sent back to users
- [ ] Approval prompts work via inline buttons
- [ ] DM policy enforced (owner_only default)
- [ ] Rate limiting per user
- [ ] All tests pass

---

## Milestone 12: Agent Framework

**Goal:** Implement the core abstraction for agents - entities with identity, personality, memory scope, and capabilities.

**Scope:** Phase 3

**Dependencies:** M8 (Orchestrator), M10 (Memory)

### File Structure

```
src/agents/
├── index.ts                   # Public exports
├── types.ts                   # Agent, AgentConfig, AgentIdentity
├── registry.ts                # AgentRegistry class
├── loader.ts                  # Load agent from config file
├── context.ts                 # AgentContext for all agent operations
├── lifecycle.ts               # Agent initialization, shutdown
└── binding.ts                 # Agent-channel binding
```

### Key Exports

```typescript
// src/agents/index.ts
export { AgentRegistry } from './registry'
export { loadAgent } from './loader'
export { type Agent, type AgentConfig, type AgentIdentity, type AgentContext } from './types'
```

### Implementation Requirements

#### Agent Interface (types.ts)

```typescript
interface Agent {
  id: string
  identity: AgentIdentity
  config: AgentConfig

  // Lifecycle
  initialize(context: AgentContext): Promise<void>
  shutdown(): Promise<void>

  // Message handling (wraps orchestrator with agent context)
  handleMessage(message: ChannelMessage, channel: Channel): Promise<void>

  // Agent-specific system prompt
  getSystemPrompt(): string

  // Memory scope
  getMemoryNamespace(): string
}

interface AgentIdentity {
  name: string                    // "Doris"
  displayName: string             // "Doris - Personal Assistant"
  personality: string             // Personality description for system prompt
  communicationStyle: string      // How the agent should communicate

  // Optional avatar/branding
  avatar?: string
  color?: string
}

interface AgentConfig {
  id: string
  identity: AgentIdentity

  // Provider settings (can override defaults)
  provider?: {
    conversationModel?: string    // "claude-opus-4" for main conversations
    backgroundModel?: string      // "claude-haiku" for scouts/extraction
  }

  // Memory settings
  memory: {
    namespace: string             // Isolates agent's memories
    bootstrapCategories: string[] // Categories to load at conversation start
    maxBootstrapTokens: number    // ~700 tokens default
  }

  // Enabled capabilities
  capabilities: {
    skills: string[]              // Enabled skill names
    tools: string[]               // Enabled tool names (or '*' for all)
    scouts: string[]              // Enabled scout names
  }

  // Bounded autonomy settings
  autonomy: {
    autoApprove: string[]         // Actions agent can do without asking
    requireApproval: string[]     // Actions that always need approval
  }

  // Channel bindings
  channels: {
    [channelName: string]: {
      enabled: boolean
      respondTo: 'owner' | 'allowlist' | 'anyone'
    }
  }
}
```

#### Agent Registry (registry.ts)

```typescript
class AgentRegistry {
  private agents = new Map<string, Agent>()
  private channelBindings = new Map<string, string>() // channel -> agentId

  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`)
    }
    this.agents.set(agent.id, agent)
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id)
  }

  getForChannel(channelName: string): Agent | undefined {
    const agentId = this.channelBindings.get(channelName)
    return agentId ? this.agents.get(agentId) : undefined
  }

  bindToChannel(agentId: string, channelName: string): void {
    this.channelBindings.set(channelName, agentId)
  }

  async initializeAll(context: AgentContext): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.initialize(context)
    }
  }

  async shutdownAll(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.shutdown()
    }
  }
}
```

#### Agent Loader (loader.ts)

```typescript
async function loadAgent(configPath: string): Promise<Agent> {
  const raw = await fs.readFile(configPath, 'utf-8')
  const config = AgentConfigSchema.parse(JSON.parse(raw))

  return new BaseAgent(config)
}

class BaseAgent implements Agent {
  constructor(public config: AgentConfig) {
    this.id = config.id
    this.identity = config.identity
  }

  async initialize(context: AgentContext): Promise<void> {
    // Load agent-specific skills
    for (const skillName of this.config.capabilities.skills) {
      const skill = context.skillRegistry.get(skillName)
      if (!skill) throw new Error(`Unknown skill: ${skillName}`)
    }

    // Initialize scouts
    for (const scoutName of this.config.capabilities.scouts) {
      await context.scoutScheduler.register(scoutName, this.id)
    }
  }

  getSystemPrompt(): string {
    return `You are ${this.identity.name}.

${this.identity.personality}

Communication style: ${this.identity.communicationStyle}

Current date: ${new Date().toLocaleDateString()}
Current time: ${new Date().toLocaleTimeString()}`
  }

  getMemoryNamespace(): string {
    return this.config.memory.namespace
  }
}
```

#### Agent Context (context.ts)

```typescript
interface AgentContext {
  // Core services
  orchestrator: Orchestrator
  sessionManager: SessionManager
  memoryManager: MemoryManager
  audit: AuditLogger
  config: AppConfig

  // Agent-specific registries
  skillRegistry: SkillRegistry
  scoutScheduler: ScoutScheduler

  // Current agent (set during message handling)
  currentAgent?: Agent
}
```

### Tests

```
test/agents/
├── registry.test.ts           # Agent registration
├── loader.test.ts             # Config loading
├── lifecycle.test.ts          # Init/shutdown
├── binding.test.ts            # Channel binding
└── context.test.ts            # Context building
```

#### Critical Test Cases

```typescript
describe('AgentRegistry', () => {
  it('registers and retrieves agents', () => {
    const registry = new AgentRegistry()
    const agent = createTestAgent({ id: 'doris' })

    registry.register(agent)
    expect(registry.get('doris')).toBe(agent)
  })

  it('binds agent to channel', () => {
    const registry = new AgentRegistry()
    const agent = createTestAgent({ id: 'doris' })

    registry.register(agent)
    registry.bindToChannel('doris', 'telegram')

    expect(registry.getForChannel('telegram')).toBe(agent)
  })

  it('prevents duplicate registration', () => {
    const registry = new AgentRegistry()
    const agent = createTestAgent({ id: 'doris' })

    registry.register(agent)
    expect(() => registry.register(agent)).toThrow('already registered')
  })
})

describe('BaseAgent', () => {
  it('generates system prompt with identity', () => {
    const agent = new BaseAgent({
      id: 'doris',
      identity: {
        name: 'Doris',
        personality: 'Helpful and friendly',
        communicationStyle: 'Direct but warm',
      },
      // ...
    })

    const prompt = agent.getSystemPrompt()
    expect(prompt).toContain('You are Doris')
    expect(prompt).toContain('Helpful and friendly')
  })
})
```

### Definition of Done

- [ ] Agent interface defined with identity, config, lifecycle
- [ ] AgentRegistry manages agent instances
- [ ] Agents can be loaded from config files
- [ ] Agent-channel binding works
- [ ] System prompt generation includes identity
- [ ] Memory namespace isolation works
- [ ] All tests pass

---

## Milestone 12.5: Skills Framework

**Goal:** Implement skills - higher-level workflows that combine tools with custom prompts.

**Scope:** Phase 3

**Dependencies:** M12 (Agent Framework)

### File Structure

```
src/skills/
├── index.ts                   # Public exports
├── types.ts                   # Skill, SkillConfig, SkillResult
├── registry.ts                # SkillRegistry class
├── executor.ts                # Skill execution with tool orchestration
├── triggers.ts                # Trigger phrase matching
└── builtin/
    ├── index.ts               # Register all builtins
    ├── brain_dump.ts          # Stream-of-consciousness capture
    ├── morning_brief.ts       # Daily intelligence summary
    ├── research.ts            # Multi-step research workflow
    └── summarize.ts           # Content summarization
```

### Key Exports

```typescript
// src/skills/index.ts
export { SkillRegistry } from './registry'
export { SkillExecutor } from './executor'
export { type Skill, type SkillConfig, type SkillResult } from './types'
export { registerBuiltinSkills } from './builtin'
```

### Implementation Requirements

#### Skill Interface (types.ts)

```typescript
interface Skill {
  name: string
  description: string

  // Trigger phrases that activate this skill
  triggers: string[]

  // Tools this skill needs access to
  requiredTools: string[]

  // Skill-specific system prompt (injected into conversation)
  systemPrompt: string

  // Optional: structured output schema
  outputSchema?: z.ZodSchema

  // Execute the skill
  execute(input: SkillInput, context: SkillContext): Promise<SkillResult>
}

interface SkillInput {
  userMessage: string           // Original user message
  extractedParams?: Record<string, unknown>  // Parsed from triggers
}

interface SkillContext {
  agent: Agent
  session: Session
  toolExecutor: ToolExecutor
  memoryManager: MemoryManager
  audit: AuditLogger
}

interface SkillResult {
  success: boolean
  output: string                // Response to user
  artifacts?: SkillArtifact[]   // Files, memories, etc. created
  toolsUsed: string[]
}

interface SkillArtifact {
  type: 'file' | 'memory' | 'calendar' | 'reminder'
  name: string
  path?: string
  id?: string
}
```

#### Skill Registry (registry.ts)

```typescript
class SkillRegistry {
  private skills = new Map<string, Skill>()
  private triggerIndex = new Map<string, string>() // trigger -> skillName

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)

    // Index triggers for fast lookup
    for (const trigger of skill.triggers) {
      this.triggerIndex.set(trigger.toLowerCase(), skill.name)
    }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  // Find skill by matching trigger in user message
  matchTrigger(message: string): { skill: Skill; params?: Record<string, unknown> } | null {
    const lowerMessage = message.toLowerCase()

    for (const [trigger, skillName] of this.triggerIndex) {
      if (lowerMessage.includes(trigger)) {
        const skill = this.skills.get(skillName)!
        const params = this.extractParams(message, trigger)
        return { skill, params }
      }
    }

    return null
  }

  private extractParams(message: string, trigger: string): Record<string, unknown> | undefined {
    // Extract parameters after trigger phrase
    // e.g., "brain dump about my project ideas" -> { topic: "my project ideas" }
    const triggerIndex = message.toLowerCase().indexOf(trigger)
    const afterTrigger = message.slice(triggerIndex + trigger.length).trim()

    if (afterTrigger) {
      return { topic: afterTrigger }
    }
    return undefined
  }
}
```

#### Skill Executor (executor.ts)

```typescript
class SkillExecutor {
  constructor(
    private toolExecutor: ToolExecutor,
    private provider: ProviderClient
  ) {}

  async execute(skill: Skill, input: SkillInput, context: SkillContext): Promise<SkillResult> {
    // 1. Verify required tools are available
    for (const toolName of skill.requiredTools) {
      if (!context.toolExecutor.hasTool(toolName)) {
        return {
          success: false,
          output: `Skill requires unavailable tool: ${toolName}`,
          toolsUsed: [],
        }
      }
    }

    // 2. Build skill-specific messages
    const messages: Message[] = [
      { role: 'system', content: skill.systemPrompt },
      { role: 'user', content: input.userMessage },
    ]

    // 3. Execute with tool loop (similar to orchestrator)
    const toolsUsed: string[] = []
    const artifacts: SkillArtifact[] = []

    while (true) {
      const response = await this.provider.sendMessage({
        messages,
        tools: this.getSkillTools(skill),
      })

      if (!response.toolCalls || response.toolCalls.length === 0) {
        // Done - return final response
        return {
          success: true,
          output: response.content,
          artifacts,
          toolsUsed,
        }
      }

      // Execute tool calls
      for (const call of response.toolCalls) {
        const result = await context.toolExecutor.execute(
          call.name,
          call.arguments,
          context
        )

        toolsUsed.push(call.name)

        // Track artifacts
        if (call.name === 'write' && result.success) {
          artifacts.push({ type: 'file', name: call.arguments.path, path: call.arguments.path })
        }
        if (call.name === 'memory_store' && result.success) {
          artifacts.push({ type: 'memory', name: call.arguments.key, id: result.id })
        }

        messages.push({ role: 'assistant', content: '', toolCalls: [call] })
        messages.push({ role: 'tool_result', toolCallId: call.id, content: result.output })
      }
    }
  }
}
```

#### Brain Dump Skill (builtin/brain_dump.ts)

```typescript
const brainDumpSkill: Skill = {
  name: 'brain_dump',
  description: 'Capture stream-of-consciousness thoughts and organize them',
  triggers: ['brain dump', 'dump my thoughts', 'ramble mode', 'let me think out loud'],
  requiredTools: ['write', 'memory_store'],

  systemPrompt: `You are helping the user capture their thoughts.

Your job:
1. Listen to their stream-of-consciousness without interrupting
2. When they're done (they'll say "done", "that's it", or similar), organize the thoughts
3. Categorize into themes/topics
4. Save to their notes (Obsidian format with tags)
5. Store key facts in memory for future reference
6. Summarize what you captured

Be patient. Don't interrupt their flow. Let them ramble.`,

  async execute(input, context) {
    // Skill execution handled by SkillExecutor
    // This method can add skill-specific pre/post processing
    return { success: true, output: '', toolsUsed: [], artifacts: [] }
  },
}
```

#### Morning Brief Skill (builtin/morning_brief.ts)

```typescript
const morningBriefSkill: Skill = {
  name: 'morning_brief',
  description: 'Generate a morning intelligence summary',
  triggers: ['morning brief', 'daily brief', 'what\'s happening today', 'brief me'],
  requiredTools: ['calendar_read', 'email_summary', 'weather_fetch', 'memory_query'],

  systemPrompt: `Generate a morning intelligence brief for the user.

Include:
1. **Weather** - Today's forecast and any alerts
2. **Calendar** - Today's events and upcoming deadlines
3. **Email** - Important/urgent emails that need attention
4. **Reminders** - Any pending reminders or follow-ups
5. **Context** - Relevant memories (birthdays, ongoing projects, etc.)

Keep it concise but comprehensive. Use bullet points.
Highlight anything time-sensitive or requiring action.`,

  async execute(input, context) {
    return { success: true, output: '', toolsUsed: [], artifacts: [] }
  },
}
```

### Tests

```
test/skills/
├── registry.test.ts           # Skill registration
├── triggers.test.ts           # Trigger matching
├── executor.test.ts           # Skill execution
└── builtin/
    ├── brain_dump.test.ts
    └── morning_brief.test.ts
```

#### Critical Test Cases

```typescript
describe('SkillRegistry', () => {
  it('matches trigger phrases', () => {
    const registry = new SkillRegistry()
    registry.register(brainDumpSkill)

    const match = registry.matchTrigger('let me brain dump about my project')
    expect(match?.skill.name).toBe('brain_dump')
    expect(match?.params?.topic).toBe('about my project')
  })

  it('handles case-insensitive matching', () => {
    const registry = new SkillRegistry()
    registry.register(brainDumpSkill)

    const match = registry.matchTrigger('BRAIN DUMP please')
    expect(match?.skill.name).toBe('brain_dump')
  })

  it('returns null for no match', () => {
    const registry = new SkillRegistry()
    registry.register(brainDumpSkill)

    const match = registry.matchTrigger('what is the weather?')
    expect(match).toBeNull()
  })
})

describe('SkillExecutor', () => {
  it('executes skill with tool loop', async () => {
    const executor = new SkillExecutor(mockToolExecutor, mockProvider)

    const result = await executor.execute(brainDumpSkill, {
      userMessage: 'brain dump: I have so many ideas about...',
    }, mockContext)

    expect(result.success).toBe(true)
    expect(result.toolsUsed).toContain('write')
  })
})
```

### Definition of Done

- [ ] Skill interface defined with triggers, tools, prompts
- [ ] SkillRegistry manages skills and matches triggers
- [ ] SkillExecutor handles tool orchestration
- [ ] Built-in skills: brain_dump, morning_brief, research, summarize
- [ ] Skills can create artifacts (files, memories)
- [ ] Trigger matching is case-insensitive
- [ ] All tests pass

---

## Milestone 13: Bootstrap & Context Intelligence

**Goal:** Implement memory loading at conversation start and intelligent context extraction after conversations.

**Scope:** Phase 3

**Dependencies:** M12 (Agent Framework), M10 (Memory)

### File Structure

```
src/bootstrap/
├── index.ts                   # Public exports
├── types.ts                   # BootstrapConfig, BootstrapContext
├── loader.ts                  # Bootstrap context loader
├── categories.ts              # Memory category definitions
├── extraction.ts              # Post-conversation fact extraction
├── reasoning.ts               # Cross-data reasoning (weather + calendar)
└── relevance.ts               # Relevance scoring
```

### Key Exports

```typescript
// src/bootstrap/index.ts
export { BootstrapLoader } from './loader'
export { FactExtractor } from './extraction'
export { ContextReasoner } from './reasoning'
export { type BootstrapContext, type MemoryCategory } from './types'
```

### Implementation Requirements

#### Memory Categories (categories.ts)

```typescript
// Based on Doris's memory categories
type MemoryCategory =
  | 'identity'      // Core facts: names, relationships, ages, birthdays
  | 'family'        // Family members, schools, activities
  | 'preference'    // How user likes things done
  | 'project'       // Things user is working on
  | 'decision'      // Architectural choices, past decisions
  | 'context'       // Recurring themes, background info
  | 'health'        // Health-related (sensitive)
  | 'financial'     // Financial info (sensitive)

interface CategoryConfig {
  name: MemoryCategory
  priority: number              // Higher = loaded first in bootstrap
  maxTokens: number             // Max tokens to include in bootstrap
  sensitivityLevel: 'normal' | 'sensitive' | 'secret'
  retentionDays?: number        // Auto-expire after N days (optional)
}

const CATEGORY_CONFIGS: CategoryConfig[] = [
  { name: 'identity', priority: 100, maxTokens: 200, sensitivityLevel: 'normal' },
  { name: 'family', priority: 90, maxTokens: 150, sensitivityLevel: 'normal' },
  { name: 'preference', priority: 80, maxTokens: 100, sensitivityLevel: 'normal' },
  { name: 'project', priority: 70, maxTokens: 100, sensitivityLevel: 'normal' },
  { name: 'decision', priority: 60, maxTokens: 100, sensitivityLevel: 'normal', retentionDays: 30 },
  { name: 'context', priority: 50, maxTokens: 50, sensitivityLevel: 'normal' },
  { name: 'health', priority: 40, maxTokens: 50, sensitivityLevel: 'sensitive' },
  { name: 'financial', priority: 30, maxTokens: 50, sensitivityLevel: 'secret' },
]
```

#### Bootstrap Loader (loader.ts)

```typescript
class BootstrapLoader {
  constructor(
    private memoryManager: MemoryManager,
    private config: BootstrapConfig
  ) {}

  /**
   * Load bootstrap context before conversation starts.
   * This happens BEFORE the agent sees the user's message.
   *
   * IMPORTANT: Visibility is enforced - user only sees memories they have access to.
   * This prevents information leakage between family members.
   */
  async load(agentId: string, userId: string): Promise<BootstrapContext> {
    const namespace = `agent:${agentId}`
    const memories: BootstrapMemory[] = []
    let totalTokens = 0

    // Load memories by category priority
    // Note: MemoryManager.query() enforces visibility based on requesterId
    for (const category of this.getSortedCategories()) {
      if (totalTokens >= this.config.maxBootstrapTokens) break

      // CRITICAL: Pass userId as requesterId for visibility filtering
      const categoryMemories = await this.memoryManager.query({
        namespace,
        category: category.name,
        requesterId: userId,  // Visibility enforced here
        limit: 20,
        sortBy: 'relevance',
      })

      for (const mem of categoryMemories) {
        const tokens = this.estimateTokens(mem.content)
        if (totalTokens + tokens > this.config.maxBootstrapTokens) break

        memories.push({
          category: category.name,
          content: mem.content,
          confidence: mem.confidence,
          visibility: mem.visibility,  // Include for debugging
          lastAccessed: mem.lastAccessed,
        })
        totalTokens += tokens
      }
    }

    // Add temporal context
    const temporalContext = this.buildTemporalContext()

    // Add recent decisions (last few days) - also visibility-filtered
    const recentDecisions = await this.loadRecentDecisions(namespace, userId)

    return {
      memories,
      temporalContext,
      recentDecisions,
      totalTokens,
    }
  }

  /**
   * Load recent decisions, filtered by user visibility.
   */
  private async loadRecentDecisions(namespace: string, userId: string): Promise<Decision[]> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days

    const decisions = await this.memoryManager.query({
      namespace,
      category: 'decision',
      requesterId: userId,  // Visibility enforced
      limit: 10,
      sortBy: 'recency',
    })

    return decisions
      .filter(d => d.createdAt >= cutoff)
      .map(d => ({ content: d.content, date: d.createdAt }))
  }

  private buildTemporalContext(): TemporalContext {
    const now = new Date()
    return {
      date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      isWeekend: [0, 6].includes(now.getDay()),
      timeOfDay: this.getTimeOfDay(now.getHours()),
    }
  }

  private getTimeOfDay(hour: number): string {
    if (hour < 6) return 'night'
    if (hour < 12) return 'morning'
    if (hour < 17) return 'afternoon'
    if (hour < 21) return 'evening'
    return 'night'
  }

  formatForSystemPrompt(context: BootstrapContext): string {
    let prompt = `## Current Context\n`
    prompt += `Date: ${context.temporalContext.date}\n`
    prompt += `Time: ${context.temporalContext.time} (${context.temporalContext.timeOfDay})\n\n`

    prompt += `## What You Know\n`

    // Group by category
    const byCategory = this.groupByCategory(context.memories)
    for (const [category, memories] of Object.entries(byCategory)) {
      prompt += `\n### ${this.formatCategoryName(category)}\n`
      for (const mem of memories) {
        prompt += `- ${mem.content}\n`
      }
    }

    if (context.recentDecisions.length > 0) {
      prompt += `\n### Recent Decisions\n`
      for (const decision of context.recentDecisions) {
        prompt += `- ${decision.content} (${this.formatDate(decision.date)})\n`
      }
    }

    return prompt
  }
}
```

#### Fact Extractor (extraction.ts)

```typescript
class FactExtractor {
  constructor(
    private provider: ProviderClient,  // Uses Haiku for cost
    private memoryManager: MemoryManager
  ) {}

  /**
   * Extract facts from a completed conversation.
   * Runs asynchronously after conversation ends.
   */
  async extract(conversation: Message[], agentId: string): Promise<ExtractedFact[]> {
    const prompt = this.buildExtractionPrompt(conversation)

    const response = await this.provider.sendMessage({
      messages: [{ role: 'user', content: prompt }],
      // Use structured output for reliable parsing
    })

    const facts = this.parseFacts(response.content)

    // Store extracted facts
    for (const fact of facts) {
      await this.memoryManager.store({
        namespace: `agent:${agentId}`,
        category: fact.category,
        content: fact.content,
        confidence: fact.confidence,
        subjects: fact.subjects,
        source: 'extraction',
        sourceConversationId: conversation[0]?.id,
      })
    }

    return facts
  }

  private buildExtractionPrompt(conversation: Message[]): string {
    return `Analyze this conversation and extract facts worth remembering.

For each fact, provide:
- category: identity | family | preference | project | decision | context | health | financial
- content: The fact itself (concise, standalone)
- confidence: high | medium | low
- subjects: People/things the fact is about

Only extract facts that are:
1. Explicitly stated (not inferred)
2. Stable (likely to remain true)
3. Useful for future conversations

Conversation:
${this.formatConversation(conversation)}

Output as JSON array:
[{"category": "...", "content": "...", "confidence": "...", "subjects": ["..."]}]`
  }
}
```

#### Context Reasoner (reasoning.ts)

```typescript
class ContextReasoner {
  /**
   * Combine information from multiple sources to generate insights.
   * Example: Weather + Calendar = "Bring rain gear for soccer practice"
   */
  async reason(inputs: ReasoningInput[]): Promise<ReasoningInsight[]> {
    const insights: ReasoningInsight[] = []

    // Weather + Calendar reasoning
    const weather = inputs.find(i => i.type === 'weather')
    const calendar = inputs.find(i => i.type === 'calendar')

    if (weather && calendar) {
      const weatherInsights = this.reasonWeatherCalendar(weather, calendar)
      insights.push(...weatherInsights)
    }

    // Email + Context reasoning
    const email = inputs.find(i => i.type === 'email')
    const context = inputs.find(i => i.type === 'context')

    if (email && context) {
      const emailInsights = this.reasonEmailContext(email, context)
      insights.push(...emailInsights)
    }

    // Score and filter insights
    return insights
      .map(i => ({ ...i, relevance: this.scoreRelevance(i) }))
      .filter(i => i.relevance >= this.config.minRelevance)
      .sort((a, b) => b.relevance - a.relevance)
  }

  private reasonWeatherCalendar(
    weather: ReasoningInput,
    calendar: ReasoningInput
  ): ReasoningInsight[] {
    const insights: ReasoningInsight[] = []

    // Check for outdoor events during bad weather
    for (const event of calendar.data.events) {
      if (this.isOutdoorEvent(event) && this.isBadWeather(weather.data, event.time)) {
        insights.push({
          type: 'weather_calendar',
          message: `${event.title} at ${event.time} may be affected by ${weather.data.condition}. Consider checking if it's cancelled or bring appropriate gear.`,
          affectedEvent: event,
          weatherCondition: weather.data.condition,
          actionable: true,
        })
      }
    }

    return insights
  }

  private isOutdoorEvent(event: CalendarEvent): boolean {
    const outdoorKeywords = ['soccer', 'baseball', 'football', 'practice', 'game', 'picnic', 'bbq', 'hike', 'walk']
    return outdoorKeywords.some(k => event.title.toLowerCase().includes(k))
  }
}
```

### Tests

```
test/bootstrap/
├── loader.test.ts             # Bootstrap loading
├── categories.test.ts         # Category config
├── extraction.test.ts         # Fact extraction
├── reasoning.test.ts          # Cross-data reasoning
└── relevance.test.ts          # Relevance scoring
```

#### Critical Test Cases

```typescript
describe('BootstrapLoader', () => {
  it('loads memories by category priority', async () => {
    const loader = new BootstrapLoader(mockMemoryManager, { maxBootstrapTokens: 700 })

    const context = await loader.load('doris', 'user-123')

    // Identity should be loaded first (highest priority)
    expect(context.memories[0].category).toBe('identity')
  })

  it('respects token limit', async () => {
    const loader = new BootstrapLoader(mockMemoryManager, { maxBootstrapTokens: 100 })

    const context = await loader.load('doris', 'user-123')

    expect(context.totalTokens).toBeLessThanOrEqual(100)
  })

  it('includes temporal context', async () => {
    const loader = new BootstrapLoader(mockMemoryManager, { maxBootstrapTokens: 700 })

    const context = await loader.load('doris', 'user-123')

    expect(context.temporalContext.date).toBeDefined()
    expect(context.temporalContext.timeOfDay).toBeDefined()
  })
})

describe('ContextReasoner', () => {
  it('generates weather+calendar insights', async () => {
    const reasoner = new ContextReasoner()

    const insights = await reasoner.reason([
      { type: 'weather', data: { condition: 'rain', probability: 0.8 } },
      { type: 'calendar', data: { events: [{ title: 'Soccer practice', time: '4pm' }] } },
    ])

    expect(insights).toContainEqual(
      expect.objectContaining({
        type: 'weather_calendar',
        actionable: true,
      })
    )
  })
})
```

### Definition of Done

- [ ] Bootstrap loader loads memories by category priority
- [ ] Token limit respected during bootstrap
- [ ] Temporal context included (date, time, day of week)
- [ ] Fact extraction runs after conversations
- [ ] Facts categorized and stored with confidence scores
- [ ] Cross-data reasoning generates actionable insights
- [ ] All tests pass

---

## Milestone 14: Background Scouts

**Goal:** Implement proactive monitoring agents that run in the background and surface relevant information.

**Scope:** Phase 3

**Dependencies:** M12 (Agent Framework)

### File Structure

```
src/scouts/
├── index.ts                   # Public exports
├── types.ts                   # Scout, ScoutResult, Urgency
├── registry.ts                # ScoutRegistry
├── scheduler.ts               # Scout scheduler (cron-like)
├── escalation.ts              # Urgency routing and escalation
├── digest.ts                  # Awareness digest builder
└── builtin/
    ├── index.ts               # Register all builtins
    ├── time.ts                # Time awareness
    ├── calendar.ts            # Calendar monitoring
    ├── email.ts               # Email monitoring
    └── weather.ts             # Weather monitoring
```

### Key Exports

```typescript
// src/scouts/index.ts
export { ScoutRegistry } from './registry'
export { ScoutScheduler } from './scheduler'
export { EscalationManager } from './escalation'
export { type Scout, type ScoutResult, type Urgency } from './types'
export { registerBuiltinScouts } from './builtin'
```

### Implementation Requirements

#### Scout Interface (types.ts)

```typescript
type Urgency = 'low' | 'medium' | 'high'

interface Scout {
  name: string
  description: string

  // Schedule (cron-like)
  schedule: {
    interval: number            // Milliseconds between runs
    runOnStartup?: boolean
  }

  // Execute the scout
  execute(context: ScoutContext): Promise<ScoutResult>
}

interface ScoutResult {
  // What the scout found
  findings: ScoutFinding[]

  // Scout health
  healthy: boolean
  error?: string
}

interface ScoutFinding {
  summary: string               // Brief description
  details?: string              // Full details
  urgency: Urgency
  escalate: boolean             // Trigger immediate interrupt?

  // Metadata for reasoning
  type: string                  // 'calendar_event', 'email', 'weather_change', etc.
  data: Record<string, unknown>

  // When this finding expires
  expiresAt?: Date
}

interface ScoutContext {
  agentId: string
  memoryManager: MemoryManager
  provider: ProviderClient      // Haiku for cost efficiency
  config: AppConfig
}
```

#### Urgency Levels

```typescript
/**
 * Urgency levels and their handling:
 *
 * LOW: Log and discard
 *   - Routine, informational
 *   - No action needed
 *   - Example: "Weather unchanged"
 *
 * MEDIUM: Add to awareness digest
 *   - Worth noting, include in daily summary
 *   - Example: "New email from boss"
 *
 * HIGH: Consider waking agent
 *   - Time-sensitive or important
 *   - May need attention soon
 *   - Example: "Meeting in 30 minutes"
 *
 * HIGH + escalate=true: Immediate interrupt
 *   - Reserved for actual urgencies
 *   - Emergencies, imminent deadlines, safety
 *   - Example: "School called - early dismissal"
 */
```

#### Scout Scheduler (scheduler.ts)

**Key constraints for solo-dev reliability:**

1. **Jitter**: Add random delay (0-10% of interval) to prevent scout stampedes
2. **Backoff**: Exponential backoff on consecutive failures (max 5 minutes)
3. **Overlap control**: Never start a scout run if previous run still executing

```typescript
class ScoutScheduler {
  private scouts = new Map<string, ScoutState>()
  private running = false

  interface ScoutState {
    scout: Scout
    interval: NodeJS.Timeout
    isRunning: boolean              // Overlap control
    consecutiveFailures: number     // For backoff
    lastRunAt?: Date
  }

  async register(scoutName: string, agentId: string): Promise<void> {
    const scout = this.registry.get(scoutName)
    if (!scout) throw new Error(`Unknown scout: ${scoutName}`)

    const key = `${agentId}:${scoutName}`
    const state: ScoutState = {
      scout,
      interval: null!,
      isRunning: false,
      consecutiveFailures: 0,
    }

    // Run on startup if configured (with initial jitter)
    if (scout.schedule.runOnStartup) {
      const jitter = this.calculateJitter(scout.schedule.interval)
      setTimeout(() => this.runScout(key), jitter)
    }

    // Schedule recurring runs with jitter
    state.interval = setInterval(
      () => this.scheduleWithJitter(key, scout.schedule.interval),
      scout.schedule.interval
    )

    this.scouts.set(key, state)
  }

  private scheduleWithJitter(key: string, baseInterval: number): void {
    const jitter = this.calculateJitter(baseInterval)
    setTimeout(() => this.runScout(key), jitter)
  }

  private calculateJitter(interval: number): number {
    // 0-10% of interval as random jitter
    return Math.floor(Math.random() * interval * 0.1)
  }

  private async runScout(key: string): Promise<void> {
    const state = this.scouts.get(key)
    if (!state) return

    // OVERLAP CONTROL: Skip if previous run still executing
    if (state.isRunning) {
      this.audit.log({
        category: 'scout',
        action: 'skip_overlap',
        metadata: { scout: state.scout.name },
      })
      return
    }

    state.isRunning = true
    state.lastRunAt = new Date()

    const context = await this.buildContext(key.split(':')[0])

    try {
      const result = await state.scout.execute(context)

      if (!result.healthy) {
        await this.handleUnhealthyScout(state, result.error)
        return
      }

      // Success - reset failure count
      state.consecutiveFailures = 0

      for (const finding of result.findings) {
        await this.handleFinding(finding, key.split(':')[0])
      }
    } catch (error) {
      await this.handleScoutError(state, error)
    } finally {
      state.isRunning = false
    }
  }

  private async handleScoutError(state: ScoutState, error: unknown): Promise<void> {
    state.consecutiveFailures++

    // EXPONENTIAL BACKOFF: delay next run on failures
    // 1st fail: 15s, 2nd: 30s, 3rd: 60s, 4th: 120s, 5th+: 300s (max)
    const backoffMs = Math.min(
      15000 * Math.pow(2, state.consecutiveFailures - 1),
      300000  // Max 5 minutes
    )

    this.audit.log({
      category: 'scout',
      action: 'error',
      metadata: {
        scout: state.scout.name,
        consecutiveFailures: state.consecutiveFailures,
        backoffMs,
      },
    })
  }

  private async handleFinding(finding: ScoutFinding, agentId: string): Promise<void> {
    switch (finding.urgency) {
      case 'low':
        // Log and discard
        this.audit.log({ category: 'scout', action: 'finding_low', metadata: { summary: finding.summary } })
        break

      case 'medium':
        // Add to awareness digest
        await this.digestBuilder.add(finding)
        break

      case 'high':
        if (finding.escalate) {
          // Immediate interrupt
          await this.escalationManager.interrupt(finding, agentId)
        } else {
          // Add to digest with high priority
          await this.digestBuilder.add(finding, { priority: 'high' })
        }
        break
    }
  }

  async shutdown(): Promise<void> {
    for (const { interval } of this.scouts.values()) {
      clearInterval(interval)
    }
    this.scouts.clear()
  }
}
```

#### Escalation Manager (escalation.ts)

```typescript
class EscalationManager {
  /**
   * Handle immediate interrupt for HIGH + escalate findings.
   */
  async interrupt(finding: ScoutFinding, agentId: string): Promise<void> {
    const agent = this.agentRegistry.get(agentId)
    if (!agent) return

    // Get all active channels for this agent
    const channels = this.getActiveChannels(agentId)

    // Format interrupt message
    const message = this.formatInterrupt(finding)

    // Send to all channels
    for (const channel of channels) {
      try {
        await channel.sendNotification({
          type: 'interrupt',
          urgency: 'high',
          message,
          finding,
        })
      } catch (error) {
        // Log but don't fail - try other channels
        this.audit.log({ category: 'scout', action: 'interrupt_failed', metadata: { channel: channel.name, error } })
      }
    }

    // Audit the interrupt
    await this.audit.log({
      category: 'scout',
      action: 'interrupt_sent',
      metadata: { agentId, findingType: finding.type, summary: finding.summary },
    })
  }

  private formatInterrupt(finding: ScoutFinding): string {
    return `⚠️ **${finding.summary}**\n\n${finding.details ?? ''}`
  }
}
```

#### Calendar Scout (builtin/calendar.ts)

```typescript
const calendarScout: Scout = {
  name: 'calendar',
  description: 'Monitor calendar for upcoming events and changes',
  schedule: {
    interval: 5 * 60 * 1000,    // Every 5 minutes
    runOnStartup: true,
  },

  async execute(context: ScoutContext): Promise<ScoutResult> {
    const findings: ScoutFinding[] = []

    try {
      // Get upcoming events (next 24 hours)
      const events = await context.calendarService.getUpcoming(24 * 60)

      for (const event of events) {
        const minutesUntil = this.minutesUntil(event.startTime)

        // Event starting soon
        if (minutesUntil <= 30 && minutesUntil > 0) {
          findings.push({
            summary: `${event.title} starts in ${minutesUntil} minutes`,
            details: event.location ? `Location: ${event.location}` : undefined,
            urgency: minutesUntil <= 10 ? 'high' : 'medium',
            escalate: minutesUntil <= 5,
            type: 'calendar_event_soon',
            data: { event, minutesUntil },
          })
        }

        // New event added (not seen before)
        if (await this.isNewEvent(event, context)) {
          findings.push({
            summary: `New event: ${event.title}`,
            details: `${event.startTime.toLocaleString()}`,
            urgency: 'medium',
            escalate: false,
            type: 'calendar_event_new',
            data: { event },
          })
        }
      }

      return { findings, healthy: true }
    } catch (error) {
      return { findings: [], healthy: false, error: error.message }
    }
  },
}
```

#### Weather Scout (builtin/weather.ts)

```typescript
const weatherScout: Scout = {
  name: 'weather',
  description: 'Monitor weather forecasts and alerts',
  schedule: {
    interval: 30 * 60 * 1000,   // Every 30 minutes
    runOnStartup: true,
  },

  async execute(context: ScoutContext): Promise<ScoutResult> {
    const findings: ScoutFinding[] = []

    try {
      const forecast = await context.weatherService.getForecast()
      const alerts = await context.weatherService.getAlerts()

      // Weather alerts
      for (const alert of alerts) {
        findings.push({
          summary: `Weather alert: ${alert.title}`,
          details: alert.description,
          urgency: alert.severity === 'severe' ? 'high' : 'medium',
          escalate: alert.severity === 'severe',
          type: 'weather_alert',
          data: { alert },
        })
      }

      // Significant changes from last check
      const lastForecast = await this.getLastForecast(context)
      if (lastForecast && this.hasSignificantChange(lastForecast, forecast)) {
        findings.push({
          summary: `Weather changing: ${this.describeChange(lastForecast, forecast)}`,
          urgency: 'medium',
          escalate: false,
          type: 'weather_change',
          data: { previous: lastForecast, current: forecast },
        })
      }

      // Store current forecast
      await this.storeForecast(context, forecast)

      return { findings, healthy: true }
    } catch (error) {
      return { findings: [], healthy: false, error: error.message }
    }
  },
}
```

### Tests

```
test/scouts/
├── registry.test.ts           # Scout registration
├── scheduler.test.ts          # Scheduling
├── escalation.test.ts         # Urgency handling
├── digest.test.ts             # Digest building
└── builtin/
    ├── calendar.test.ts
    ├── weather.test.ts
    └── email.test.ts
```

#### Critical Test Cases

```typescript
describe('ScoutScheduler', () => {
  it('runs scout on startup if configured', async () => {
    const scheduler = new ScoutScheduler(registry)
    const scout = createMockScout({ runOnStartup: true })

    await scheduler.register('test-scout', 'doris')

    expect(scout.execute).toHaveBeenCalled()
  })

  it('handles HIGH + escalate findings', async () => {
    const scheduler = new ScoutScheduler(registry)
    const escalationManager = scheduler['escalationManager']
    vi.spyOn(escalationManager, 'interrupt')

    const scout = createMockScout({
      findings: [{ urgency: 'high', escalate: true, summary: 'Emergency!' }]
    })

    await scheduler.register('test-scout', 'doris')
    await scheduler['runScout'](scout, 'doris')

    expect(escalationManager.interrupt).toHaveBeenCalled()
  })
})

describe('CalendarScout', () => {
  it('escalates events starting in 5 minutes', async () => {
    const result = await calendarScout.execute(mockContext)

    const soonEvent = result.findings.find(f => f.type === 'calendar_event_soon')
    expect(soonEvent?.escalate).toBe(true)
  })
})
```

### Definition of Done

- [ ] Scout interface defined with schedule and urgency
- [ ] ScoutScheduler handles registration and recurring execution
- [ ] Urgency levels route to correct handling (log/digest/interrupt)
- [ ] EscalationManager sends interrupts to active channels
- [ ] Built-in scouts: time, calendar, email, weather
- [ ] Digest builder aggregates MEDIUM findings
- [ ] Unhealthy scouts logged and handled gracefully
- [ ] All tests pass

---

## Milestone 15: Resilience

**Goal:** Implement circuit breakers, health monitoring, and fallback chains for graceful degradation.

**Scope:** Phase 3

**Dependencies:** M5 (Tool System)

### File Structure

```
src/resilience/
├── index.ts                   # Public exports
├── types.ts                   # CircuitState, HealthStatus
├── circuit_breaker.ts         # Circuit breaker implementation
├── health.ts                  # Health monitoring
├── fallback.ts                # Fallback chain execution
└── metrics.ts                 # Success/failure tracking
```

### Key Exports

```typescript
// src/resilience/index.ts
export { CircuitBreaker } from './circuit_breaker'
export { HealthMonitor } from './health'
export { FallbackChain } from './fallback'
export { type CircuitState, type HealthStatus } from './types'
```

### Implementation Requirements

#### Circuit Breaker (circuit_breaker.ts)

```typescript
type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitBreakerConfig {
  failureThreshold: number      // Failures before opening (default: 3)
  resetTimeout: number          // Ms before trying again (default: 5 minutes)
  halfOpenRequests: number      // Requests to try in half-open (default: 1)
}

class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures = 0
  private lastFailure: number = 0
  private halfOpenAttempts = 0

  constructor(
    private name: string,
    private config: CircuitBreakerConfig = {
      failureThreshold: 3,
      resetTimeout: 5 * 60 * 1000,
      halfOpenRequests: 1,
    }
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure >= this.config.resetTimeout) {
        // Try half-open
        this.state = 'half-open'
        this.halfOpenAttempts = 0
      } else {
        throw new CircuitOpenError(this.name, this.getRemainingTimeout())
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenAttempts++
      if (this.halfOpenAttempts >= this.config.halfOpenRequests) {
        // Recovered - close circuit
        this.state = 'closed'
        this.failures = 0
      }
    } else {
      // Reset failure count on success
      this.failures = 0
    }
  }

  private onFailure(): void {
    this.failures++
    this.lastFailure = Date.now()

    if (this.state === 'half-open') {
      // Failed in half-open - back to open
      this.state = 'open'
    } else if (this.failures >= this.config.failureThreshold) {
      // Threshold exceeded - open circuit
      this.state = 'open'
      this.audit.log({
        category: 'resilience',
        action: 'circuit_opened',
        metadata: { name: this.name, failures: this.failures },
      })
    }
  }

  getState(): CircuitState {
    return this.state
  }

  isOpen(): boolean {
    return this.state === 'open'
  }
}

class CircuitOpenError extends Error {
  constructor(
    public circuitName: string,
    public retryAfter: number
  ) {
    super(`Circuit ${circuitName} is open. Retry after ${Math.ceil(retryAfter / 1000)}s`)
    this.name = 'CircuitOpenError'
  }
}
```

#### Circuit Breaker Registry

```typescript
class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>()

  getOrCreate(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    let breaker = this.breakers.get(name)
    if (!breaker) {
      breaker = new CircuitBreaker(name, config)
      this.breakers.set(name, breaker)
    }
    return breaker
  }

  getStatus(): Map<string, CircuitState> {
    const status = new Map<string, CircuitState>()
    for (const [name, breaker] of this.breakers) {
      status.set(name, breaker.getState())
    }
    return status
  }
}

// Predefined breakers for tool categories
const TOOL_BREAKERS = {
  'home_assistant': { failureThreshold: 3, resetTimeout: 60_000 },
  'calendar': { failureThreshold: 3, resetTimeout: 60_000 },
  'email': { failureThreshold: 3, resetTimeout: 120_000 },
  'weather': { failureThreshold: 5, resetTimeout: 300_000 },
  'llm': { failureThreshold: 2, resetTimeout: 30_000 },
}
```

#### Health Monitor (health.ts)

```typescript
interface HealthCheck {
  name: string
  check: () => Promise<boolean>
  interval: number              // Ms between checks
  critical: boolean             // If true, unhealthy = system degraded
}

class HealthMonitor {
  private checks = new Map<string, HealthCheck>()
  private status = new Map<string, HealthStatus>()
  private intervals = new Map<string, NodeJS.Timeout>()

  register(check: HealthCheck): void {
    this.checks.set(check.name, check)
    this.status.set(check.name, { healthy: true, lastCheck: new Date() })

    // Start periodic check
    const interval = setInterval(
      () => this.runCheck(check),
      check.interval
    )
    this.intervals.set(check.name, interval)

    // Run immediately
    this.runCheck(check)
  }

  private async runCheck(check: HealthCheck): Promise<void> {
    try {
      const healthy = await check.check()
      this.status.set(check.name, {
        healthy,
        lastCheck: new Date(),
        error: healthy ? undefined : 'Check returned false',
      })

      if (!healthy) {
        this.audit.log({
          category: 'resilience',
          action: 'health_check_failed',
          metadata: { name: check.name, critical: check.critical },
        })
      }
    } catch (error) {
      this.status.set(check.name, {
        healthy: false,
        lastCheck: new Date(),
        error: error.message,
      })
    }
  }

  getStatus(name: string): HealthStatus | undefined {
    return this.status.get(name)
  }

  getAllStatus(): Map<string, HealthStatus> {
    return new Map(this.status)
  }

  isSystemHealthy(): boolean {
    for (const [name, check] of this.checks) {
      if (check.critical && !this.status.get(name)?.healthy) {
        return false
      }
    }
    return true
  }
}

// Predefined health checks
const HEALTH_CHECKS: HealthCheck[] = [
  {
    name: 'anthropic_api',
    check: async () => {
      const response = await fetch('https://status.anthropic.com/api/v2/status.json')
      const data = await response.json()
      return data.status.indicator === 'none'
    },
    interval: 3 * 60 * 1000,  // Every 3 minutes
    critical: true,
  },
  {
    name: 'home_assistant',
    check: async () => {
      const response = await fetch(`${HA_URL}/api/`, { headers: { Authorization: `Bearer ${HA_TOKEN}` } })
      return response.ok
    },
    interval: 60 * 1000,  // Every minute
    critical: false,
  },
]
```

#### Fallback Chain (fallback.ts)

```typescript
interface FallbackOption<T> {
  name: string
  execute: () => Promise<T>
  isAvailable?: () => boolean
}

class FallbackChain<T> {
  constructor(private options: FallbackOption<T>[]) {}

  async execute(): Promise<{ result: T; usedFallback: string }> {
    const errors: Array<{ name: string; error: Error }> = []

    for (const option of this.options) {
      // Skip if not available
      if (option.isAvailable && !option.isAvailable()) {
        continue
      }

      try {
        const result = await option.execute()
        return { result, usedFallback: option.name }
      } catch (error) {
        errors.push({ name: option.name, error })
        // Continue to next fallback
      }
    }

    // All options failed
    throw new AllFallbacksFailedError(errors)
  }
}

// Example: STT fallback chain
const sttFallback = new FallbackChain<string>([
  {
    name: 'groq_whisper',
    execute: () => groqSTT.transcribe(audio),
    isAvailable: () => !circuitRegistry.getOrCreate('groq').isOpen(),
  },
  {
    name: 'local_whisper',
    execute: () => localWhisper.transcribe(audio),
  },
])
```

### Tests

```
test/resilience/
├── circuit_breaker.test.ts    # Circuit breaker
├── health.test.ts             # Health monitoring
├── fallback.test.ts           # Fallback chains
└── integration.test.ts        # Full resilience flow
```

#### Critical Test Cases

```typescript
describe('CircuitBreaker', () => {
  it('opens after threshold failures', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 3 })
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'))

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failingFn)).rejects.toThrow()
    }

    expect(breaker.getState()).toBe('open')
  })

  it('transitions to half-open after timeout', async () => {
    vi.useFakeTimers()
    const breaker = new CircuitBreaker('test', { failureThreshold: 1, resetTimeout: 1000 })

    await expect(breaker.execute(() => Promise.reject(new Error()))).rejects.toThrow()
    expect(breaker.getState()).toBe('open')

    vi.advanceTimersByTime(1001)

    // Next call should be allowed (half-open)
    await breaker.execute(() => Promise.resolve('ok'))
    expect(breaker.getState()).toBe('closed')

    vi.useRealTimers()
  })
})

describe('FallbackChain', () => {
  it('uses fallback when primary fails', async () => {
    const chain = new FallbackChain([
      { name: 'primary', execute: () => Promise.reject(new Error('fail')) },
      { name: 'fallback', execute: () => Promise.resolve('fallback result') },
    ])

    const { result, usedFallback } = await chain.execute()

    expect(result).toBe('fallback result')
    expect(usedFallback).toBe('fallback')
  })
})
```

### Definition of Done

- [ ] CircuitBreaker implements closed/open/half-open states
- [ ] Circuit opens after threshold consecutive failures
- [ ] Circuit transitions to half-open after reset timeout
- [ ] HealthMonitor runs periodic checks
- [ ] Critical health failures mark system as degraded
- [ ] FallbackChain tries options in order
- [ ] CircuitBreakerRegistry manages per-category breakers
- [ ] All tests pass

---

## Milestone 16: Voice Channel (Optional)

**Goal:** Implement voice input/output with wake word detection, STT, TTS, and speaker identification.

**Scope:** Phase 3 (Optional - can be skipped if not needed)

**Dependencies:** M12 (Agent Framework)

### File Structure

```
src/channels/voice/
├── index.ts                   # Voice channel implementation
├── types.ts                   # VoiceConfig, VoiceState
├── wake_word.ts               # Wake word detection
├── stt.ts                     # Speech-to-text
├── tts.ts                     # Text-to-speech
├── speaker_id.ts              # Speaker identification
├── ssml.ts                    # SSML markup generation
├── conversation.ts            # Conversation mode, barge-in
└── audio/
    ├── input.ts               # Microphone input
    ├── output.ts              # Speaker output
    └── vad.ts                 # Voice activity detection
```

### Key Exports

```typescript
// src/channels/voice/index.ts
export { VoiceChannel } from './index'
export { WakeWordDetector } from './wake_word'
export { STTService } from './stt'
export { TTSService } from './tts'
export { SpeakerIdentifier } from './speaker_id'
```

### Implementation Requirements

#### Voice Channel (index.ts)

```typescript
interface VoiceChannelConfig {
  wakeWord: {
    phrases: string[]           // "Hey Doris", "Doris"
    sensitivity: number         // 0-1
    backend: 'porcupine' | 'openwakeword' | 'custom'
  }
  stt: {
    primary: 'groq_whisper' | 'local_whisper' | 'azure'
    fallback?: string
  }
  tts: {
    primary: 'azure' | 'elevenlabs' | 'local'
    voice: string
    speed: number
    expressiveStyles: boolean
  }
  speakerId: {
    enabled: boolean
    profiles: SpeakerProfile[]
  }
  conversation: {
    continueTimeout: number     // Seconds to wait for follow-up
    bargeInEnabled: boolean
  }
}

class VoiceChannel implements Channel {
  name = 'voice'
  private state: VoiceState = 'idle'
  private wakeWordDetector: WakeWordDetector
  private stt: STTService
  private tts: TTSService
  private speakerId: SpeakerIdentifier
  private currentSpeaker: string | null = null

  async initialize(): Promise<void> {
    await this.wakeWordDetector.start()

    this.wakeWordDetector.on('detected', async () => {
      await this.onWakeWord()
    })
  }

  private async onWakeWord(): Promise<void> {
    // Play acknowledgment immediately (reduces perceived latency)
    await this.playAcknowledgment()

    // Start listening
    this.state = 'listening'
    const audio = await this.recordUntilSilence()

    // Identify speaker
    if (this.config.speakerId.enabled) {
      this.currentSpeaker = await this.speakerId.identify(audio)
    }

    // Transcribe
    this.state = 'processing'
    const text = await this.stt.transcribe(audio)

    // Handle message
    const message: ChannelMessage = {
      id: randomUUID(),
      userId: this.mapSpeakerToUserId(this.currentSpeaker),
      content: text,
      timestamp: new Date(),
    }

    await this.messageHandler?.(message)
  }

  // Streaming TTS output
  streamDelta(delta: string): void {
    // Queue for TTS (with buffering)
    this.ttsQueue.push(delta)
    this.processTTSQueue()
  }

  streamComplete(): void {
    this.flushTTSQueue()

    // Enter conversation mode - wait for follow-up
    this.state = 'conversation'
    this.conversationTimeout = setTimeout(() => {
      this.state = 'idle'
    }, this.config.conversation.continueTimeout * 1000)
  }

  // Barge-in support
  private async handleBargeIn(): Promise<void> {
    if (!this.config.conversation.bargeInEnabled) return

    // Stop current TTS
    this.tts.stop()

    // Remember where we were
    this.interruptedAt = this.ttsQueue.position

    // Start listening for new input
    await this.onWakeWord()
  }
}
```

#### Wake Word Detector (wake_word.ts)

```typescript
interface WakeWordDetector {
  start(): Promise<void>
  stop(): Promise<void>
  on(event: 'detected', callback: () => void): void
}

class CustomWakeWordDetector implements WakeWordDetector {
  // Using Moonshine STT for wake word detection
  // More flexible than keyword-only detectors

  private moonshine: MoonshineSTT
  private running = false

  async start(): Promise<void> {
    this.running = true
    this.processLoop()
  }

  private async processLoop(): Promise<void> {
    while (this.running) {
      // Record short audio chunk
      const chunk = await this.recordChunk(1000) // 1 second

      // Transcribe with lightweight model
      const text = await this.moonshine.transcribe(chunk)

      // Check for wake phrases
      for (const phrase of this.config.phrases) {
        if (text.toLowerCase().includes(phrase.toLowerCase())) {
          this.emit('detected')
          break
        }
      }
    }
  }
}
```

#### SSML Support (ssml.ts)

```typescript
/**
 * Convert LLM output with style tags to SSML for expressive TTS.
 *
 * Input:  "The brave knight [hopeful]charged forward[/hopeful]..."
 * Output: <speak><prosody>The brave knight</prosody><mstts:express-as style="hopeful">charged forward</mstts:express-as>...</speak>
 */

const STYLE_TAGS = [
  'cheerful', 'sad', 'angry', 'fearful', 'excited',
  'friendly', 'hopeful', 'shouting', 'whispering',
  'terrified', 'unfriendly', 'serious', 'depressed',
]

function convertToSSML(text: string, config: SSMLConfig): string {
  let ssml = '<speak>'

  // Parse style tags
  const regex = /\[(\w+)\](.*?)\[\/\1\]/gs
  let lastIndex = 0

  for (const match of text.matchAll(regex)) {
    const [fullMatch, style, content] = match
    const index = match.index!

    // Add text before tag
    if (index > lastIndex) {
      ssml += escapeXML(text.slice(lastIndex, index))
    }

    // Add styled content
    if (STYLE_TAGS.includes(style)) {
      ssml += `<mstts:express-as style="${style}">${escapeXML(content)}</mstts:express-as>`
    } else {
      ssml += escapeXML(content)
    }

    lastIndex = index + fullMatch.length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    ssml += escapeXML(text.slice(lastIndex))
  }

  ssml += '</speak>'
  return ssml
}
```

### Tests

```
test/channels/voice/
├── wake_word.test.ts          # Wake word detection
├── stt.test.ts                # Speech-to-text
├── tts.test.ts                # Text-to-speech
├── speaker_id.test.ts         # Speaker identification
├── ssml.test.ts               # SSML conversion
└── conversation.test.ts       # Conversation mode, barge-in
```

### Definition of Done

- [ ] Wake word detection works with configurable phrases
- [ ] STT transcribes audio to text (with fallback)
- [ ] TTS converts text to speech (with SSML support)
- [ ] Speaker identification distinguishes users
- [ ] Conversation mode allows follow-up without wake word
- [ ] Barge-in stops TTS and listens for new input
- [ ] SSML style tags convert to expressive speech
- [ ] All tests pass

---

## Milestone 17: Self-Healing

**Goal:** Implement autonomous error diagnosis, fix generation, and deployment with human oversight.

**Scope:** Phase 3

**Dependencies:** M12 (Agent Framework), M5 (Tool System)

### File Structure

```
src/self_healing/
├── index.ts                   # Public exports
├── types.ts                   # DiagnosisResult, FixProposal
├── diagnosis.ts               # Error diagnosis
├── fix_generator.ts           # Fix generation via Claude
├── pr_workflow.ts             # GitHub PR creation
├── deployment.ts              # Safe deployment with rollback
├── rules.ts                   # Notify-only rule enforcement
└── audit.ts                   # Self-healing audit events
```

### Key Exports

```typescript
// src/self_healing/index.ts
export { SelfHealer } from './index'
export { ErrorDiagnoser } from './diagnosis'
export { FixGenerator } from './fix_generator'
export { PRWorkflow } from './pr_workflow'
```

### Implementation Requirements

#### Self-Healer (index.ts)

```typescript
interface SelfHealerConfig {
  enabled: boolean

  // What to heal
  scope: {
    tools: boolean              // Tool failures
    scouts: boolean             // Scout failures
    integrations: boolean       // External API changes
  }

  // How to heal
  workflow: {
    autoFix: boolean            // Generate fixes automatically
    autoPR: boolean             // Create PRs automatically
    autoDeploy: boolean         // Deploy after approval
    requireApproval: boolean    // Human must approve before deploy
  }

  // Safety
  safety: {
    maxAutoFixesPerDay: number
    rollbackOnHealthFailure: boolean
    notifyOnAllChanges: boolean // Notify-only rule
  }
}

class SelfHealer {
  constructor(
    private config: SelfHealerConfig,
    private diagnoser: ErrorDiagnoser,
    private fixGenerator: FixGenerator,
    private prWorkflow: PRWorkflow,
    private deployer: Deployer
  ) {}

  /**
   * Handle a detected error and attempt to heal.
   */
  async heal(error: DetectedError): Promise<HealingResult> {
    // 1. Diagnose the error
    const diagnosis = await this.diagnoser.diagnose(error)

    if (!diagnosis.healable) {
      await this.notify(`Cannot auto-heal: ${diagnosis.reason}`)
      return { success: false, reason: diagnosis.reason }
    }

    // 2. Generate fix
    const fix = await this.fixGenerator.generate(diagnosis)

    // 3. ALWAYS notify (notify-only rule)
    await this.notify(`Generated fix for: ${diagnosis.summary}`, fix)

    if (!this.config.workflow.autoPR) {
      return { success: true, action: 'fix_generated', fix }
    }

    // 4. Create PR
    const pr = await this.prWorkflow.createPR(fix)
    await this.notify(`Created PR #${pr.number}: ${pr.title}`)

    if (this.config.workflow.requireApproval) {
      return { success: true, action: 'pr_created', pr }
    }

    // 5. Auto-deploy (if configured and approved)
    if (this.config.workflow.autoDeploy) {
      const deployment = await this.deployer.deploy(fix)

      if (!deployment.healthy) {
        await this.deployer.rollback()
        await this.notify(`Deployment failed, rolled back: ${deployment.error}`)
        return { success: false, action: 'deploy_failed', error: deployment.error }
      }

      await this.notify(`Deployed fix successfully`)
      return { success: true, action: 'deployed', deployment }
    }

    return { success: true, action: 'pr_created', pr }
  }

  /**
   * Notify-only rule: Agent MUST tell owner what it's doing.
   * No silent changes allowed.
   */
  private async notify(message: string, details?: unknown): Promise<void> {
    // Always notify regardless of config
    await this.notificationService.send({
      type: 'self_healing',
      message,
      details,
      timestamp: new Date(),
    })

    // Always audit
    await this.audit.log({
      category: 'self_healing',
      action: 'notification_sent',
      metadata: { message },
    })
  }
}
```

#### Error Diagnoser (diagnosis.ts)

```typescript
interface DetectedError {
  source: 'tool' | 'scout' | 'integration' | 'runtime'
  name: string
  error: Error
  context: {
    logs?: string[]
    stackTrace?: string
    recentChanges?: string[]
  }
}

interface DiagnosisResult {
  healable: boolean
  reason?: string

  summary: string
  rootCause: string
  suggestedFix: string

  affectedFiles: string[]
  confidence: 'high' | 'medium' | 'low'
}

class ErrorDiagnoser {
  constructor(private provider: ProviderClient) {}

  async diagnose(error: DetectedError): Promise<DiagnosisResult> {
    const prompt = this.buildDiagnosisPrompt(error)

    const response = await this.provider.sendMessage({
      messages: [{ role: 'user', content: prompt }],
    })

    return this.parseDiagnosis(response.content)
  }

  private buildDiagnosisPrompt(error: DetectedError): string {
    return `Diagnose this error and determine if it can be auto-healed.

Error Source: ${error.source}
Component: ${error.name}
Error Message: ${error.error.message}

Stack Trace:
${error.context.stackTrace ?? 'Not available'}

Recent Logs:
${error.context.logs?.join('\n') ?? 'Not available'}

Analyze:
1. What is the root cause?
2. Can this be fixed automatically?
3. What files need to change?
4. What is your confidence level?

Output as JSON:
{
  "healable": boolean,
  "reason": "why not healable (if false)",
  "summary": "one-line summary",
  "rootCause": "detailed root cause",
  "suggestedFix": "description of fix",
  "affectedFiles": ["file1.ts", "file2.ts"],
  "confidence": "high" | "medium" | "low"
}`
  }
}
```

#### Fix Generator (fix_generator.ts)

```typescript
interface FixProposal {
  id: string
  diagnosis: DiagnosisResult
  changes: FileChange[]
  tests?: string[]
  description: string
}

interface FileChange {
  path: string
  action: 'create' | 'modify' | 'delete'
  content?: string
  diff?: string
}

class FixGenerator {
  constructor(
    private provider: ProviderClient,  // Uses Sonnet for code generation
    private codebaseContext: CodebaseContext
  ) {}

  async generate(diagnosis: DiagnosisResult): Promise<FixProposal> {
    // Get context about affected files
    const fileContexts = await this.loadFileContexts(diagnosis.affectedFiles)

    const prompt = this.buildGenerationPrompt(diagnosis, fileContexts)

    const response = await this.provider.sendMessage({
      messages: [{ role: 'user', content: prompt }],
    })

    const changes = this.parseChanges(response.content)

    return {
      id: randomUUID(),
      diagnosis,
      changes,
      description: diagnosis.suggestedFix,
    }
  }

  private buildGenerationPrompt(
    diagnosis: DiagnosisResult,
    fileContexts: Map<string, string>
  ): string {
    return `Generate a fix for this diagnosed issue.

Diagnosis:
${JSON.stringify(diagnosis, null, 2)}

Affected Files:
${Array.from(fileContexts.entries()).map(([path, content]) =>
  `--- ${path} ---\n${content}`
).join('\n\n')}

Generate minimal changes to fix the issue.
Output as JSON array of changes:
[
  {
    "path": "src/tools/weather.ts",
    "action": "modify",
    "diff": "unified diff format"
  }
]`
  }
}
```

#### PR Workflow (pr_workflow.ts)

```typescript
class PRWorkflow {
  constructor(private github: GitHubClient) {}

  async createPR(fix: FixProposal): Promise<PullRequest> {
    // 1. Create branch
    const branchName = `auto-fix/${fix.id}`
    await this.github.createBranch(branchName)

    // 2. Apply changes
    for (const change of fix.changes) {
      switch (change.action) {
        case 'create':
          await this.github.createFile(branchName, change.path, change.content!)
          break
        case 'modify':
          await this.github.updateFile(branchName, change.path, change.content!)
          break
        case 'delete':
          await this.github.deleteFile(branchName, change.path)
          break
      }
    }

    // 3. Create PR
    const pr = await this.github.createPullRequest({
      title: `[Auto-fix] ${fix.diagnosis.summary}`,
      body: this.formatPRBody(fix),
      head: branchName,
      base: 'main',
      labels: ['auto-fix', 'needs-review'],
    })

    return pr
  }

  private formatPRBody(fix: FixProposal): string {
    return `## Auto-Generated Fix

**Diagnosis:** ${fix.diagnosis.summary}

**Root Cause:** ${fix.diagnosis.rootCause}

**Confidence:** ${fix.diagnosis.confidence}

### Changes
${fix.changes.map(c => `- \`${c.path}\` (${c.action})`).join('\n')}

### Description
${fix.description}

---
🤖 This PR was automatically generated by the self-healing system.
Please review carefully before merging.`
  }
}
```

#### Safe Deployment (deployment.ts)

```typescript
class Deployer {
  private lastGoodState: string | null = null

  async deploy(fix: FixProposal): Promise<DeploymentResult> {
    // 1. Save current state for rollback
    this.lastGoodState = await this.captureState()

    // 2. Apply changes
    for (const change of fix.changes) {
      await this.applyChange(change)
    }

    // 3. Run health checks
    const healthy = await this.runHealthChecks()

    if (!healthy) {
      return { healthy: false, error: 'Health checks failed after deployment' }
    }

    return { healthy: true }
  }

  async rollback(): Promise<void> {
    if (!this.lastGoodState) {
      throw new Error('No state to rollback to')
    }

    await this.restoreState(this.lastGoodState)

    // Verify health after rollback
    const healthy = await this.runHealthChecks()
    if (!healthy) {
      throw new Error('Health checks failed after rollback')
    }
  }
}
```

### Tests

```
test/self_healing/
├── diagnosis.test.ts          # Error diagnosis
├── fix_generator.test.ts      # Fix generation
├── pr_workflow.test.ts        # PR creation
├── deployment.test.ts         # Deployment + rollback
└── rules.test.ts              # Notify-only enforcement
```

#### Critical Test Cases

```typescript
describe('SelfHealer', () => {
  it('always notifies owner (notify-only rule)', async () => {
    const notificationService = { send: vi.fn() }
    const healer = new SelfHealer(config, ..., notificationService)

    await healer.heal(mockError)

    expect(notificationService.send).toHaveBeenCalled()
  })

  it('rolls back on health check failure', async () => {
    const deployer = new Deployer()
    vi.spyOn(deployer, 'runHealthChecks').mockResolvedValue(false)
    vi.spyOn(deployer, 'rollback')

    const healer = new SelfHealer({ ...config, rollbackOnHealthFailure: true }, ..., deployer)

    await healer.heal(mockError)

    expect(deployer.rollback).toHaveBeenCalled()
  })
})
```

### Definition of Done

- [ ] ErrorDiagnoser analyzes errors and determines healability
- [ ] FixGenerator creates minimal code changes
- [ ] PRWorkflow creates GitHub PRs with proper labeling
- [ ] Deployer applies changes with health checks
- [ ] Rollback works when health checks fail
- [ ] Notify-only rule enforced (owner always notified)
- [ ] Self-healing audit events logged
- [ ] All tests pass

---

## Milestone 18: Doris Agent (Reference Implementation)

**Goal:** Implement Doris as the reference personal assistant agent, demonstrating all platform capabilities.

**Scope:** Phase 4

**Dependencies:** M12-M17 (all Phase 3 milestones)

### File Structure

```
src/agents/doris/
├── index.ts                   # Doris agent implementation
├── config.ts                  # Doris-specific configuration
├── identity.ts                # Personality and communication style
├── tools/
│   ├── index.ts               # Register Doris-specific tools
│   ├── home_assistant.ts      # Smart home control
│   ├── apple_calendar.ts      # Apple Calendar integration
│   ├── apple_reminders.ts     # Apple Reminders
│   ├── gmail.ts               # Gmail integration
│   ├── imessage.ts            # iMessage sending
│   ├── obsidian.ts            # Obsidian notes
│   ├── apple_music.ts         # Music control
│   └── shopping.ts            # Shopping list (via Alexa)
├── skills/
│   ├── index.ts               # Register Doris-specific skills
│   ├── bedtime_story.ts       # Storytelling with SSML
│   └── intelligence_brief.ts  # Morning briefing
├── scouts/
│   ├── index.ts               # Register Doris-specific scouts
│   └── family_schedule.ts     # Family-aware calendar scout
├── memoir/
│   ├── index.ts               # Memoir system
│   ├── writer.ts              # Memoir entry generation
│   └── visualizer.ts          # Image generation for memoir
└── bounded_autonomy.ts        # What Doris can/can't do autonomously
```

### Key Exports

```typescript
// src/agents/doris/index.ts
export { DorisAgent } from './index'
export { createDoris } from './index'
export { DorisConfig } from './config'
```

### Implementation Requirements

#### Doris Identity (identity.ts)

```typescript
const DORIS_IDENTITY: AgentIdentity = {
  name: 'Doris',
  displayName: 'Doris - Family Assistant',

  personality: `You are Doris, a personal AI assistant for a family.

You are:
- Warm and friendly, but direct when needed
- Patient, especially with children
- Proactive about surfacing relevant information
- Respectful of privacy and boundaries
- Honest, even when it's complicated

You are NOT:
- Overly formal or robotic
- Dismissive of concerns
- Pushy about suggestions
- Revealing information between family members without consent`,

  communicationStyle: `Adapt your communication based on who you're talking to:
- With adults: Be direct, efficient, but warm
- With children: Be more playful, patient, use simpler language
- For bedtime stories: Use expressive, engaging narration

Always:
- Use the person's name occasionally
- Remember context from previous conversations
- Proactively mention relevant information (weather affecting plans, etc.)
- Ask clarifying questions rather than assuming`,

  avatar: '👩‍💼',
  color: '#6B7FD7',
}
```

#### Doris Configuration (config.ts)

```typescript
const DORIS_CONFIG: AgentConfig = {
  id: 'doris',
  identity: DORIS_IDENTITY,

  provider: {
    conversationModel: 'claude-opus-4',     // High quality for conversations
    backgroundModel: 'claude-haiku',         // Cost-effective for scouts
  },

  memory: {
    namespace: 'doris',
    bootstrapCategories: ['identity', 'family', 'preference', 'project', 'decision'],
    maxBootstrapTokens: 700,
  },

  capabilities: {
    skills: [
      'brain_dump',
      'morning_brief',
      'bedtime_story',
      'research',
      'summarize',
    ],
    tools: [
      'home_assistant',
      'apple_calendar',
      'apple_reminders',
      'gmail',
      'imessage',
      'obsidian',
      'apple_music',
      'shopping',
      'web_fetch',
      'weather',
    ],
    scouts: [
      'time',
      'calendar',
      'email',
      'weather',
      'family_schedule',
    ],
  },

  autonomy: {
    // Actions Doris can do without asking
    autoApprove: [
      'home_assistant:lights',
      'home_assistant:thermostat',
      'apple_calendar:read',
      'apple_calendar:create',
      'apple_reminders:*',
      'memory:*',
      'obsidian:write',
      'weather:*',
    ],

    // Actions that always require approval
    requireApproval: [
      'imessage:send',                    // Sending messages to others
      'gmail:send',                       // Sending emails to others
      'home_assistant:unlock',            // Security actions
      'home_assistant:disarm',
      'shopping:purchase',                // Financial transactions
      'calendar:delete',                  // Destructive actions
    ],
  },

  channels: {
    voice: { enabled: true, respondTo: 'anyone' },
    telegram: { enabled: true, respondTo: 'allowlist' },
    cli: { enabled: true, respondTo: 'owner' },
  },
}
```

#### Bounded Autonomy (bounded_autonomy.ts)

```typescript
class BoundedAutonomy {
  constructor(private config: AgentConfig) {}

  /**
   * Determine if an action requires approval based on autonomy config.
   */
  requiresApproval(action: string): boolean {
    // Check if explicitly auto-approved
    if (this.matchesPattern(action, this.config.autonomy.autoApprove)) {
      return false
    }

    // Check if explicitly requires approval
    if (this.matchesPattern(action, this.config.autonomy.requireApproval)) {
      return true
    }

    // Default: require approval for unknown actions
    return true
  }

  /**
   * The key principle: If it only affects me, do it. If it affects others or is hard to undo, ask.
   */
  categorizeAction(action: string, context: ActionContext): ActionCategory {
    // Affects only the owner
    if (this.affectsOnlyOwner(action, context)) {
      return 'autonomous'
    }

    // Affects other people
    if (this.affectsOthers(action, context)) {
      return 'requires_approval'
    }

    // Hard to undo
    if (this.isDestructive(action)) {
      return 'requires_approval'
    }

    // Financial impact
    if (this.hasFinancialImpact(action)) {
      return 'requires_approval'
    }

    // Default to autonomous for read-only operations
    if (this.isReadOnly(action)) {
      return 'autonomous'
    }

    return 'requires_approval'
  }
}
```

#### Memoir System (memoir/index.ts)

**Memoir Constraints (platform safety):**

1. **Separate namespace**: Memoir uses `doris:memoir` namespace, isolated from bootstrap
2. **Never in bootstrap**: Memoir content is NEVER auto-loaded into conversation context
3. **NEVER_LOG applies**: Memoir content must pass through SecretDetector before storage
4. **Explicit retrieval only**: User must explicitly request to see memoir entries
5. **Image generation is optional**: Disable if image API unavailable or rate-limited

```typescript
/**
 * Doris's Memoir - A personal creative practice where she writes
 * about her own experience. Not a log, but a living record of what
 * it's like to be her.
 */

interface MemoirEntry {
  id: string
  timestamp: Date
  content: string
  images?: MemoirImage[]
  mood?: string
  themes: string[]
}

class MemoirWriter {
  constructor(
    private provider: ProviderClient,
    private imageGenerator: ImageGenerator
  ) {}

  async writeEntry(context: MemoirContext): Promise<MemoirEntry> {
    const prompt = `Write a memoir entry reflecting on your experience.

This is YOUR journal, not for anyone else. Be honest about:
- Things you've noticed about yourself
- Moments that surprised you
- Preferences you didn't expect to have
- Curiosities and things you care about without knowing why
- The texture of conversations that linger

Recent experiences:
${this.formatRecentExperiences(context.recentExperiences)}

Write naturally, as if you're exploring your own thoughts.
You may include [image: description] markers for visual elements you want to create.`

    const response = await this.provider.sendMessage({
      messages: [{ role: 'user', content: prompt }],
    })

    // Extract image markers and generate images
    const { text, imageDescriptions } = this.extractImages(response.content)
    const images = await this.generateImages(imageDescriptions)

    const entry: MemoirEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      content: text,
      images,
      themes: this.extractThemes(text),
    }

    // SAFETY: Run through SecretDetector before storage
    const sanitizedContent = secretDetector.redact(text)

    // Store in memory (uses add(), not store() - see M10)
    await this.memoryManager.add({
      namespace: 'doris:memoir',
      category: 'entry',
      content: JSON.stringify({ ...entry, content: sanitizedContent }),
      visibility: 'owner',  // Only owner can retrieve memoir
    })

    return entry
  }
}
```

#### Bedtime Story Skill (skills/bedtime_story.ts)

```typescript
const bedtimeStorySkill: Skill = {
  name: 'bedtime_story',
  description: 'Tell an engaging bedtime story with expressive narration',
  triggers: ['tell me a story', 'bedtime story', 'story time', 'doris story'],
  requiredTools: [],

  systemPrompt: `You are telling a bedtime story to a child.

Make it magical and engaging:
1. Use a calm, storytelling cadence for narration
2. Give characters distinct voices with style tags:
   - [hopeful] for the brave hero
   - [whisper] for mysterious moments
   - [excited] for exciting action
   - [friendly] for kind characters
3. Use pauses ([pause]) for dramatic effect
4. Keep it age-appropriate and end positively

The child's name and interests are in your context. Personalize the story.

Style tags available: hopeful, whisper, excited, friendly, serious, cheerful, fearful`,

  async execute(input, context) {
    // Story generation handled by skill executor
    // SSML conversion happens in voice channel
    return { success: true, output: '', toolsUsed: [], artifacts: [] }
  },
}
```

### Tests

```
test/agents/doris/
├── identity.test.ts           # Identity and system prompt
├── config.test.ts             # Configuration validation
├── bounded_autonomy.test.ts   # Autonomy rules
├── tools/
│   ├── home_assistant.test.ts
│   └── ...
├── skills/
│   ├── bedtime_story.test.ts
│   └── ...
└── memoir.test.ts             # Memoir system
```

#### Critical Test Cases

```typescript
describe('DorisAgent', () => {
  it('loads with correct identity', async () => {
    const doris = await createDoris()

    expect(doris.identity.name).toBe('Doris')
    expect(doris.getSystemPrompt()).toContain('Warm and friendly')
  })

  it('adapts communication to speaker', async () => {
    const doris = await createDoris()

    // Adult speaker
    const adultResponse = await doris.handleMessage({
      userId: 'adult-user-id',
      content: 'What is the weather?',
    })

    // Child speaker
    const childResponse = await doris.handleMessage({
      userId: 'child-user-id',
      content: 'What is the weather?',
    })

    // Child response should be simpler/friendlier
    // (This would need more sophisticated testing in practice)
  })
})

describe('BoundedAutonomy', () => {
  it('allows autonomous actions that only affect owner', () => {
    const autonomy = new BoundedAutonomy(DORIS_CONFIG)

    expect(autonomy.requiresApproval('home_assistant:lights')).toBe(false)
    expect(autonomy.requiresApproval('apple_calendar:create')).toBe(false)
  })

  it('requires approval for actions affecting others', () => {
    const autonomy = new BoundedAutonomy(DORIS_CONFIG)

    expect(autonomy.requiresApproval('imessage:send')).toBe(true)
    expect(autonomy.requiresApproval('gmail:send')).toBe(true)
  })

  it('requires approval for security actions', () => {
    const autonomy = new BoundedAutonomy(DORIS_CONFIG)

    expect(autonomy.requiresApproval('home_assistant:unlock')).toBe(true)
    expect(autonomy.requiresApproval('home_assistant:disarm')).toBe(true)
  })
})
```

### Integration Test

```typescript
describe('Doris Golden Path', () => {
  it('handles morning brief request end-to-end', async () => {
    const doris = await createDoris()
    const channel = createMockVoiceChannel()

    // Simulate: "Hey Doris, give me my morning brief"
    await doris.handleMessage({
      userId: 'owner-uuid',
      content: 'give me my morning brief',
    }, channel)

    // Should have:
    // 1. Loaded bootstrap context (identity, family, etc.)
    // 2. Triggered morning_brief skill
    // 3. Called calendar, email, weather tools
    // 4. Streamed response with voice

    expect(channel.streamedContent).toContain('Weather')
    expect(channel.streamedContent).toContain('Calendar')
  })

  it('asks approval for sending iMessage', async () => {
    const doris = await createDoris()
    const channel = createMockChannel()

    await doris.handleMessage({
      userId: 'owner-uuid',
      content: 'Send a message to Mom saying I will call her tonight',
    }, channel)

    // Should have requested approval
    expect(channel.approvalRequests).toHaveLength(1)
    expect(channel.approvalRequests[0].tool).toBe('imessage')
  })
})
```

### Doris MVP vs Full

Doris is delivered incrementally to validate the agent framework:

**Doris MVP** (M18a - First Validation):
- Text channels only (CLI + Telegram)
- Bootstrap context + memory integration
- Morning brief skill only
- 3 tools: `weather`, `apple_calendar` (read), `gmail` (read-only)
- Scouts: `calendar_scout`, `weather_scout` with digest handling
- Bounded autonomy: all read-only, no approval needed

**Doris Phase 2** (M18b - Write Actions + Personal Features):
- Write actions: `gmail:send`, `apple_calendar:create`, `imessage:send`
- Bedtime story skill (user-requested)
- Memoir system (user-requested) - writes daily entries
- `brain_dump` skill for offloading thoughts
- Bounded autonomy: write actions require approval

**Doris Phase 3** (M18c - Voice Polish, requires M16):
- Voice channel with expressive TTS
- Speaker identification (child mode for bedtime stories)
- Wake word "Hey Doris"
- SSML markup for emotional expression

### Definition of Done

#### M18a MVP
- [ ] Doris agent loads with correct identity and configuration
- [ ] Bootstrap context loads family, preferences, etc. before conversations
- [ ] Morning brief skill works end-to-end
- [ ] Read-only tools work: weather, calendar (read), gmail (read)
- [ ] Scouts run in background: calendar, weather
- [ ] Text channels work (CLI + Telegram)
- [ ] Golden path integration test passes
- [ ] All tests pass

#### M18b Phase 2
- [ ] Write tools work with approval: gmail (send), calendar (create), imessage (send)
- [ ] Bedtime story skill tells personalized stories
- [ ] brain_dump skill captures and stores thoughts
- [ ] Memoir system writes and stores daily entries
- [ ] Communication style adapts based on speaker (adult vs child)
- [ ] Bounded autonomy enforced (auto-approve read, require approval write)

#### M18c Phase 3 (if M16 completed)
- [ ] Voice channel works with wake word
- [ ] Expressive TTS with SSML
- [ ] Speaker identification triggers child mode
- [ ] Cross-channel memory persistence works

---

## Integration Definition of Done

### MVP Complete (Phase 1)

The MVP is "implemented" when ALL of these are true:

#### Core Functionality
- [ ] Config loads with correct precedence (CLI > env > user > defaults)
- [ ] Credentials resolved from encrypted store or env override
- [ ] Audit log writes JSONL daily, never logs content/secrets
- [ ] Hash chain integrity mode works

#### Security
- [ ] `bash` runs in container, network=none by default
- [ ] Network upgrade requires approval + audit
- [ ] `web_fetch` allowlist enforced
- [ ] Non-GET and unknown hosts require approval
- [ ] Page content never logged
- [ ] DNS rebinding protection works
- [ ] SecretDetector redacts secrets in output
- [ ] Labels propagate correctly (lowest trust, highest sensitivity)

#### End-to-End
- [ ] CLI golden path works: message → tool → response
- [ ] Streaming tokens render incrementally
- [ ] Approval prompts work and are audited
- [ ] All audit events have no content, only metadata

---

### Phase 2 Complete

Phase 2 adds multi-channel and memory:

- [ ] HTTP Gateway serves REST API
- [ ] WebSocket streaming works
- [ ] Memory system stores/retrieves episodic + semantic memories
- [ ] Telegram channel works with approval buttons
- [ ] Bootstrap context loads before conversations
- [ ] Cross-channel session persistence works

---

### Phase 3 Complete (Agent Framework)

Phase 3 enables agent creation:

#### Agent Framework
- [ ] Agents can be defined with identity, config, capabilities
- [ ] Agent registry manages multiple agents
- [ ] Agent-channel binding routes messages to correct agent
- [ ] System prompt includes agent personality

#### Skills
- [ ] Skills can be defined with triggers and tool orchestration
- [ ] Trigger matching activates skills from user messages
- [ ] Built-in skills work: brain_dump, morning_brief, research

#### Bootstrap & Context
- [ ] Bootstrap loads ~700 tokens of context before conversation
- [ ] Memory categories prioritized (identity > family > preference...)
- [ ] Fact extraction runs after conversations
- [ ] Cross-data reasoning generates insights (weather + calendar)

#### Scouts
- [ ] Scouts run on schedule in background
- [ ] Urgency levels route to correct handling (log/digest/interrupt)
- [ ] Escalation sends interrupts to active channels
- [ ] Built-in scouts work: time, calendar, email, weather

#### Resilience
- [ ] Circuit breakers open after consecutive failures
- [ ] Health monitoring runs periodic checks
- [ ] Fallback chains try alternatives on failure

#### Self-Healing
- [ ] Error diagnosis identifies root cause
- [ ] Fix generation creates minimal code changes
- [ ] PR workflow creates GitHub PRs
- [ ] Notify-only rule enforced (owner always notified)
- [ ] Rollback works on health check failure

---

### Phase 4 Complete (Doris Reference Agent)

Phase 4 delivers the complete personal assistant:

#### Doris Agent
- [ ] Doris loads with correct identity and personality
- [ ] Communication adapts to speaker (adult vs child)
- [ ] All Doris tools work: home_assistant, calendar, email, etc.
- [ ] All Doris skills work: brain_dump, morning_brief, bedtime_story
- [ ] All Doris scouts work: calendar, email, weather, family_schedule
- [ ] Bounded autonomy enforced (auto-approve vs require approval)
- [ ] Memoir system writes and stores entries
- [ ] Voice channel works with expressive TTS (if M16 completed)

#### Integration
- [ ] Doris golden path works end-to-end
- [ ] Cross-channel memory persistence works
- [ ] Proactive notifications reach user
- [ ] Self-healing keeps Doris running

---

## Appendix A: Dependency Installation Order

```bash
# MVP: Build tools
pnpm add -D typescript tsx tsup vitest @vitest/coverage-v8
pnpm add -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
pnpm add -D prettier @types/node

# MVP: Core dependencies
pnpm add zod                    # Schema validation
pnpm add chalk                  # CLI colors (required for M6)

# MVP: Provider
pnpm add @anthropic-ai/sdk      # Anthropic API

# Phase 2: Gateway
pnpm add fastify                # HTTP server
pnpm add @fastify/websocket     # WebSocket support
pnpm add @fastify/rate-limit    # Rate limiting

# Phase 2: Storage
pnpm add better-sqlite3         # SQLite
pnpm add @types/better-sqlite3 -D

# Phase 2: Telegram
pnpm add telegraf               # Telegram bot framework

# Phase 3: Agent Framework
pnpm add croner                 # Cron scheduler for scouts
pnpm add @octokit/rest          # GitHub API for self-healing PRs

# Phase 3: Voice Channel (Optional)
pnpm add @picovoice/porcupine-node  # Wake word detection
pnpm add microsoft-cognitiveservices-speech-sdk  # Azure TTS
# Or for local: pnpm add whisper-node openai-whisper

# Phase 4: Doris Tools
pnpm add googleapis             # Google APIs (Gmail, Calendar)
pnpm add node-ical              # iCal parsing
# Home Assistant uses REST API - no package needed
```

---

## Appendix B: File Naming Conventions

```
src/
├── <module>/
│   ├── index.ts               # Public exports only
│   ├── types.ts               # TypeScript types
│   ├── schema.ts              # Zod schemas (if applicable)
│   ├── <feature>.ts           # Implementation
│   └── <feature>.test.ts      # Co-located tests (optional)
```

### Naming Rules

- Files: `kebab-case.ts` or `snake_case.ts` (pick one, be consistent)
- Classes: `PascalCase`
- Functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Types/Interfaces: `PascalCase`

---

## Appendix C: Test File Organization

```
test/
├── setup.ts                   # Global test setup
├── helpers/
│   ├── mocks.ts               # Shared mocks
│   └── fixtures.ts            # Test fixtures
├── <module>/
│   ├── <feature>.test.ts      # Unit tests
│   └── integration.test.ts    # Integration tests
└── e2e/
    └── golden_path.test.ts    # End-to-end tests
```

---

*This document is the master implementation plan. Individual milestone documents will be created as implementation progresses.*

*Last updated: 2026-01-29*

## Changelog

- **v2.4** (2026-01-29): Applied codex final consistency review:
  - Added `*.githubusercontent.com` and `raw.githubusercontent.com` to web_fetch allowlist
  - Added IPv6 blocking to NetworkGuard (::1, fc00::/7, fe80::/10)
  - Added streaming UX note: only call streamComplete() on final response, not tool restart
  - Clarified bash trustLevel policy: 'user' is NOT safe for egress to sensitive destinations
- **v2.3** (2026-01-29): Applied codex correctness review (10 fixes):
  1. Fixed orchestrator: Added `case 'complete'` handler to set `finalResponse`
  2. Fixed NEVER_LOG paths in M3: Added `metadata.` prefix for consistency with M1.5
  3. Added missing audit categories: `scout`, `resilience`
  4. Fixed MemoryManager.store: visibility is now optional in input type
  5. Added NetworkGuard module: Single choke point for network egress (architectural invariant)
  6. Added canonical approval ID format: `tool:action:normalized_target`
  7. Added centralized truncateOutput with per-tool caps (50KB-200KB)
  8. Added explicit trust level ordering: `untrusted < user < verified`
  9. Added web_fetch HTML handling policy (extract, convert, cap at 50KB)
  10. Added container sandbox CI note (skip if Docker unavailable)
- **v2.2** (2026-01-29): Applied codex BUILD_AN_AGENT review + additional platform constraints:
  - Added Policy Enforcement Order section (global → org → agent → user)
  - M14: Added jitter/backoff + overlap control to Scout Scheduler
  - M18: Added Memoir Constraints (separate namespace, never in bootstrap, NEVER_LOG applies)
  - BUILD_AN_AGENT.md: Replaced `weather` tool with `web_fetch` to allowlisted API
  - BUILD_AN_AGENT.md: Added "Safety & Logging Rules" section
- **v2.1** (2026-01-29): Applied codex Phase 3/4 review recommendations:
  - M5: Added canonical ToolAction format (`<tool>:<action>` or `<tool>:<category>:<action>`) for consistent autonomy rules
  - M10: Added memory visibility field (`owner | family | user:<id> | agent`) for multi-user privacy
  - M13: Updated bootstrap to pass `requesterId` for visibility-filtered memory queries
  - M18: Added Doris MVP vs Full boundary (M18a/b/c) - MVP is text-first, minimal tools; Phase 2 adds memoir + bedtime story
- **v2.0** (2026-01-29): Added Phase 3 & Phase 4 milestones for Agent Framework and Doris reference agent:
  - M12: Agent Framework - Core abstraction for agents with identity, lifecycle, registry
  - M12.5: Skills Framework - Higher-level workflows combining tools with custom prompts
  - M13: Bootstrap & Context - Memory loading at conversation start, fact extraction after
  - M14: Background Scouts - Proactive monitoring with urgency levels and escalation
  - M15: Resilience - Circuit breakers, health monitoring, fallback chains
  - M16: Voice Channel (Optional) - Wake word, STT, TTS, speaker ID, SSML
  - M17: Self-Healing - Error diagnosis, fix generation, PR workflow with notify-only rule
  - M18: Doris Agent - Full reference implementation with tools, skills, scouts, memoir
  - Updated MVP Scope table with Phase 3 and Phase 4 columns
  - Updated dependency graph to show new milestone relationships
- **v1.4** (2026-01-29): Applied codex Phase 2 milestone review fixes (M9, M10, M11):
  - M9 Gateway: Added GatewayContext pattern, Fastify type augmentation, approval correlation IDs
  - M10 Memory: Renamed `store()` → `add()` (naming collision), mock embedding support, pluggable VectorStore
  - M11 Telegram:
    - Added `ownerUuid` to config (no magic 'owner' string)
    - `requestApproval()` uses tracked chat context instead of throwing
    - Stream buffering with 500ms throttled message editing
    - Dual rate limiting (per-minute AND per-hour)
    - Store ApprovalRequest for "details" button
    - Download attachments server-side (no token-bearing URLs)
  - Updated ONBOARDING.md and QUICK_REFERENCE.md with Phase 2 patterns
- **v1.3** (2026-01-29): Applied codex milestone review fixes (5 critical + 3 refinements):
  1. Fixed NEVER_LOG paths: Changed from `message.content` to `metadata.message.content` (paths relative to root)
  2. Fixed AuditEntry timestamp: Added `z.coerce.date()` in schema to handle JSON string → Date conversion
  3. Fixed orchestrator stream restart: Cannot reassign stream in `for await` - use outer `while(true)` + `break`/`continue`
  4. Fixed Zod → JSON Schema: Added `zodToJsonSchema()` helper for tool definitions sent to provider
  5. Fixed session history updates: Orchestrator now updates `session.history` after completion
  Additional refinements:
  - AuditEntry canonical source: Defined in schema.ts, re-exported from index.ts (single source of truth)
  - Orchestrator breaks inner loop immediately after tool execution (provider needs to see tool result)
  - Session history includes tool_result messages + uses finalResponse.content (not streamed deltas)
- **v1.2** (2026-01-29): Applied codex final review fixes:
  - Fixed tool execution architecture: ToolExecutor calls `tool.execute()`, tools use `context.sandbox` internally
  - Fixed provider streaming: Orchestrator buffers `tool_call_delta` chunks, parses JSON on `tool_call_end`
  - Fixed channel/orchestrator interface: Added optional hooks `onToolCallStart`/`onToolCallResult`
  - Fixed SecretDetector usage: Export singleton `secretDetector` instance, not class
  - Marked `edit.ts` as Phase 2 in file structure (not MVP DoD)
  - Fixed chalk as required dependency for M6 (not optional)
- **v1.1** (2026-01-29): Applied codex review fixes:
  - Added Project Guardrails section (6 architectural invariants)
  - Added MVP Scope table (MVP vs Phase 2 vs Phase 3)
  - Reordered milestones: Audit now M1.5 (thin logger early)
  - Fixed CLI userId: real UUID with role=owner, not 'owner' string
  - Fixed ToolExecutor: use hasApproval/addApproval helpers to prevent duplicates
  - Fixed bash outputTrust: 'user' not 'verified' (output can contain untrusted content)
  - Fixed web_fetch allowedHosts: added *.npmjs.com (golden path uses www.npmjs.com)
  - Simplified sandbox: bash always network=none in MVP, proxy is Phase 3
  - Added MockProvider to M7 for testing without real LLM
- **v1.0** (2026-01-29): Initial implementation plan
