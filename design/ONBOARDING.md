# Developer Onboarding Guide

Welcome to **meao** - a personal AI platform project. This guide will help you understand the project, set up your environment, and start contributing effectively.

---

## Table of Contents

1. [What is meao?](#what-is-meao)
2. [Why This Project Matters](#why-this-project-matters)
3. [Architecture Overview](#architecture-overview)
4. [Key Concepts You'll Learn](#key-concepts-youll-learn)
5. [Setting Up Your Environment](#setting-up-your-environment)
6. [Project Structure](#project-structure)
7. [Understanding the Milestone System](#understanding-the-milestone-system)
8. [How to Contribute](#how-to-contribute)
9. [Coding Standards](#coding-standards)
10. [Testing Requirements](#testing-requirements)
11. [Security Principles](#security-principles)
12. [Common Patterns](#common-patterns)
13. [Troubleshooting](#troubleshooting)
14. [Resources](#resources)

---

## What is meao?

meao is a **personal AI assistant platform** that you can run on your own machine. Think of it as your own Claude or ChatGPT that:

- Runs locally (your data stays with you)
- Can execute tools (browse the web, run commands, read/write files)
- Works through multiple interfaces (CLI, Telegram, web)
- Has built-in security and approval workflows

### The Problem We're Solving

When you use ChatGPT or Claude, your conversations go to their servers. meao lets you have a powerful AI assistant while keeping control of your data and being able to customize how it works.

### What Makes This Project Special

This isn't just another chatbot. meao is designed with:

1. **Security-first architecture** - Every tool execution goes through approval workflows
2. **Plugin-based design** - Easy to add new tools, channels, and providers
3. **Three-tier memory** - The AI can remember things across conversations
4. **Audit logging** - Everything is logged (safely) for debugging and compliance

---

## Why This Project Matters

By working on meao, you'll gain hands-on experience with:

| Skill | Where You'll Use It |
|-------|---------------------|
| TypeScript | Entire codebase |
| System Design | Architecture, module boundaries |
| Security Engineering | Secret detection, sandboxing, approvals |
| API Design | Provider abstraction, channel interface |
| Testing | Unit tests, integration tests, mocking |
| AI/LLM Integration | Anthropic API, tool calling, streaming |
| Container Isolation | Docker sandboxing |
| Real-time Communication | WebSocket streaming |

These are skills that top tech companies look for. You're not just building a project - you're building your portfolio.

---

## Architecture Overview

### The Big Picture

```
┌─────────────────────────────────────────────────────────────┐
│                         CHANNELS                             │
│              (How users interact with meao)                  │
│         ┌─────────┐  ┌──────────┐  ┌─────────┐             │
│         │   CLI   │  │ Telegram │  │   Web   │             │
│         └────┬────┘  └────┬─────┘  └────┬────┘             │
└──────────────┼────────────┼─────────────┼───────────────────┘
               │            │             │
               ▼            ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                            │
│           (The brain that coordinates everything)            │
│                                                              │
│   User Message → Provider → Tool Calls → Response           │
└──────────────────────────────────────────────────────────────┘
               │                    │
               ▼                    ▼
┌──────────────────────┐  ┌────────────────────────────────────┐
│      PROVIDER        │  │            TOOLS                    │
│  (AI Model Access)   │  │    (Actions the AI can take)       │
│                      │  │                                     │
│  • Anthropic Claude  │  │  • read (files)    • bash (shell)  │
│  • OpenAI (future)   │  │  • write (files)   • web_fetch     │
│  • Local (future)    │  │  • edit (files)    • more...       │
└──────────────────────┘  └────────────────────────────────────┘
```

### How a Message Flows Through the System

Let's trace what happens when you type "Fetch the npm docs for lodash":

```
1. CLI Channel receives your message
         ↓
2. Orchestrator gets the message and sends it to the Provider (Claude)
         ↓
3. Provider (Claude) decides to use a tool: web_fetch
         ↓
4. ToolExecutor checks: "Is this allowed?"
   • Is web_fetch enabled? ✓
   • Is npmjs.com on the allowlist? ✓
   • Is GET method (safe)? ✓
   → Auto-approved!
         ↓
5. Tool executes the fetch
         ↓
6. SecretDetector scans output for leaked secrets
         ↓
7. Output is labeled (trust level, data class)
         ↓
8. Audit logs the action (WITHOUT the page content)
         ↓
9. Provider receives tool result, generates response
         ↓
10. Response streams back to CLI
```

### The Three Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    PLATFORM CORE                             │
│         (Stable foundation - rarely changes)                 │
│                                                              │
│   Config │ Audit │ Security │ Sandbox                       │
└─────────────────────────────────────────────────────────────┘
                           ↑
┌─────────────────────────────────────────────────────────────┐
│                     AGENT CORE                               │
│           (Orchestration - changes sometimes)                │
│                                                              │
│   Orchestrator │ Memory │ Provider                          │
└─────────────────────────────────────────────────────────────┘
                           ↑
┌─────────────────────────────────────────────────────────────┐
│                       PLUGINS                                │
│            (Extensions - changes often)                      │
│                                                              │
│   Channels │ Tools │ Skills                                 │
└─────────────────────────────────────────────────────────────┘
```

**Why this matters:** When you understand these layers, you know where to put new code and what might break if you change something.

---

## Key Concepts You'll Learn

### 1. Configuration Precedence

meao uses a "layered" configuration system. Later layers override earlier ones:

```
defaults → config.json → config.local.json → env vars → CLI args
```

**Why?** This lets you:
- Have sensible defaults
- Override for your machine (config.local.json - not committed to git)
- Override for production (env vars)
- Override for testing (CLI args)

### 2. The NEVER_LOG Principle

Some data should **never** be written to logs:

```typescript
// These fields are ALWAYS removed before logging
// Note: Paths are relative to metadata.* in AuditEntry
const NEVER_LOG_FIELDS = [
  'metadata.message.content',   // User messages
  'metadata.tool.output',       // Command output
  'metadata.file.content',      // File contents
  'metadata.memory.content',    // Memory entries
  'metadata.response.text',     // AI responses
]
```

**Why?** Logs often end up in unexpected places (error trackers, cloud services). We log *metadata* (what happened, when, who) but never *content* (what was said, what was in the file).

**Important:** The paths include the `metadata.` prefix because `AuditEntry.metadata` is the dynamic field where these values appear.

### 3. Labels and Trust

Every piece of content has a "label" that tracks:

```typescript
interface ContentLabel {
  trustLevel: 'verified' | 'user' | 'untrusted'
  dataClass: 'public' | 'internal' | 'sensitive' | 'secret'
}
```

**Trust levels:**
- `verified` - System-generated or admin-approved
- `user` - From authenticated user input
- `untrusted` - From external sources (web, APIs)

**Data classes:**
- `public` - Safe to share anywhere
- `internal` - Keep within the system
- `sensitive` - Handle with care
- `secret` - Never expose (API keys, passwords)

**The key rule:** When combining content, use the *lowest* trust and *highest* sensitivity.

### 4. Approval Workflows

Tools that can cause harm require approval:

```
Auto-approved:       GET to known safe hosts
Needs approval:      POST to any host
Always needs:        rm commands, file writes outside project
```

**Why?** The AI might be tricked into doing something harmful. Human-in-the-loop approval prevents this.

### 5. Sandbox Isolation

The `bash` tool runs in a Docker container with:
- No network access (`--network=none`)
- Limited CPU and memory
- Read-only filesystem (except workspace)
- No root access

**Why?** If the AI executes malicious code, it can't escape or cause damage.

### 6. Phase 2 Concepts (M9, M10, M11)

Once the MVP is complete, Phase 2 adds these capabilities:

**M9 - Gateway (HTTP/WebSocket API):**
- `GatewayContext` pattern passes shared services to route handlers
- Approval messages include correlation IDs (`requestId`, `correlationId`, `toolCallId`) for audit trail
- Fastify type augmentation declares `request.user` for TypeScript

**M10 - Memory (Three-Tier):**
- **Working Memory** - Current conversation context
- **Episodic Memory** - Past interactions (vector search)
- **Semantic Memory** - Long-term knowledge (key-value)
- Uses `add()` method (not `store()` - naming collision avoided)
- VectorStore is pluggable: MVP uses brute-force cosine similarity in JS

**M11 - Telegram Channel:**
- Maps Telegram user ID to internal `ownerUuid` (no magic strings!)
- Dual rate limiting: per-minute AND per-hour limits
- Stream buffering with 500ms throttle for simulated streaming
- Downloads attachments server-side to avoid exposing bot token in URLs

### 7. Phase 3 Concepts (Agent Framework)

**M12 - Agent Framework:**
- Agent = identity + personality + memory scope + tools + skills
- AgentRegistry manages multiple agents
- Agent-channel binding routes messages to correct agent

**M12.5 - Skills Framework:**
- Skills are composed workflows (higher-level than tools)
- Trigger matching activates skills from user messages
- Skills can orchestrate multiple tools with custom prompts

**M13 - Bootstrap & Context:**
- Loads ~700 tokens of core context BEFORE seeing user message
- Memory categories prioritized (identity > family > preferences)
- Fact extraction runs after conversations to update memory

**M14 - Background Scouts:**
- Proactive monitoring with urgency levels (LOW/MEDIUM/HIGH)
- Jitter + backoff to prevent stampedes
- Overlap control: never start a scout if previous run still executing

**M15 - Resilience:**
- Circuit breakers: open after threshold failures
- Fallback chains: try alternatives on failure
- Health monitoring with periodic checks

### 8. Phase 4 Concepts (Doris Reference Agent)

**M18 - Doris Agent:**
- Full reference implementation demonstrating all platform capabilities
- Bounded autonomy: read-only actions auto-approved, writes need approval
- Memory visibility: `owner | family | user:<id> | agent`
- Doris MVP (M18a): Text-first, minimal tools, morning brief skill
- Doris Phase 2 (M18b): Write actions, bedtime story, memoir system
- Doris Phase 3 (M18c): Voice channel polish (if M16 completed)

---

## Setting Up Your Environment

### Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 20+ | Runtime |
| pnpm | 8+ | Package manager |
| Docker | Latest | For sandbox |
| Git | Latest | Version control |
| VS Code | Latest | Recommended editor |

### Step-by-Step Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd meao

# 2. Install dependencies
pnpm install

# 3. Verify your setup
pnpm check

# This runs:
# - pnpm typecheck (TypeScript compilation)
# - pnpm lint (Code style)
# - pnpm test (All tests)

# 4. Try the CLI (once built)
./bin/meao --version
```

### VS Code Extensions (Recommended)

Install these for the best experience:

- **ESLint** - Shows lint errors inline
- **Prettier** - Auto-formats on save
- **TypeScript Vue Plugin (Volar)** - Better TS support
- **Error Lens** - Shows errors inline

### Configuring VS Code

Add to `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

---

## Project Structure

```
meao/
├── bin/                    # CLI entry point
│   └── meao               # The executable
├── src/                    # Source code
│   ├── index.ts           # Main entry
│   ├── config/            # Configuration system
│   ├── audit/             # Audit logging
│   ├── security/          # SecretDetector, Labels, Flow Control
│   ├── sandbox/           # Process and Container isolation
│   ├── tools/             # Tool registry and builtins
│   ├── channels/          # CLI, Telegram, etc.
│   ├── provider/          # AI providers (Anthropic, etc.)
│   ├── orchestrator/      # Message routing
│   └── memory/            # Working, Episodic, Semantic memory
├── test/                   # Tests (mirrors src/ structure)
├── design/                 # Design documents
│   ├── ARCHITECTURE.md
│   ├── IMPLEMENTATION.md
│   ├── milestones/        # Individual milestone specs
│   └── ...
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### File Naming Conventions

```
src/<module>/
├── index.ts           # Public exports ONLY
├── types.ts           # TypeScript interfaces
├── schema.ts          # Zod validation schemas (if needed)
├── <feature>.ts       # Implementation
└── <feature>.test.ts  # Co-located tests (optional)
```

### What Goes Where

| If you're adding... | Put it in... |
|---------------------|--------------|
| New tool | `src/tools/builtin/` |
| New channel | `src/channels/` |
| New config option | `src/config/schema.ts` |
| New audit category | `src/audit/types.ts` |
| Secret pattern | `src/security/secrets/patterns.ts` |

---

## Understanding the Milestone System

### What Are Milestones?

Milestones are self-contained units of work. Each milestone:
- Has a clear goal
- Lists what files to create
- Shows expected code structure
- Has tests to verify completion
- Has a "Definition of Done" checklist

### Milestone Overview

| # | Name | Purpose | Scope | Status |
|---|------|---------|-------|--------|
| 0 | Repo Setup | Build tools, test runner | MVP | ✅ Done |
| 1 | Config | Configuration + credentials | MVP | |
| 1.5 | Audit (Thin) | Basic JSONL logging | MVP | |
| 2 | Security | SecretDetector + Labels | MVP | |
| 3 | Audit (Full) | Upgrade with SecretDetector | MVP | |
| 4 | Sandbox | Process + container isolation | MVP | |
| 5 | Tools | Registry + executor + builtins | MVP | |
| 6 | CLI | First user interface | MVP | |
| 7 | Provider | MockProvider + Anthropic | MVP | |
| 8 | Orchestrator | Ties everything together | MVP | |
| 9 | Gateway | HTTP + WebSocket | Phase 2 | |
| 10 | Memory | Three-tier memory | Phase 2 | |
| 11 | Telegram | Second channel | Phase 2 | |
| 12 | Agent Framework | Agent identity, lifecycle, registry | Phase 3 | |
| 12.5 | Skills Framework | Composable tool workflows | Phase 3 | |
| 13 | Bootstrap & Context | Memory loading, fact extraction | Phase 3 | |
| 14 | Background Scouts | Proactive monitoring | Phase 3 | |
| 15 | Resilience | Circuit breakers, fallbacks | Phase 3 | |
| 16 | Voice Channel | Wake word, STT, TTS (optional) | Phase 3 | |
| 17 | Self-Healing | Auto-diagnosis, PR workflow | Phase 3 | |
| 18 | Doris Agent | Reference personal assistant | Phase 4 | |

### Dependency Graph

```
M0 ──┬──→ M1 ──→ M1.5 ──┬──→ M3 ──→ M4 ──→ M5 ──┬──→ M6 ──┬──→ M8 (MVP!)
     │                   │                        │         │
     └──→ M2 ────────────┘                        └──→ M7 ──┘
                                                            │
                                          Phase 2:          ├──→ M9  ──┐
                                                            ├──→ M10 ──┼──→ M12 ──→ M12.5 ──→ M13 ──→ M14 ──┐
                                                            └──→ M11 ──┘                     │              │
                                                                                             └──→ M15       │
                                          Phase 3:                                           └──→ M17 ──────┤
                                                                                             └──→ M16 (opt) │
                                                                                                            │
                                          Phase 4:                                                          └──→ M18 (Doris)
```

**MVP boundary:** M0 → M8
**Phase 2 boundary:** M9, M10, M11
**Phase 3 boundary:** M12, M12.5, M13, M14, M15, M16, M17
**Phase 4 boundary:** M18 (Doris reference agent)

### How to Read a Milestone Document

Each milestone document (`design/milestones/M*.md`) has:

1. **Status & Dependencies** - What needs to be done first
2. **Goal** - What this milestone achieves
3. **File Structure** - What files to create
4. **Key Exports** - What the module exposes
5. **Implementation Requirements** - Detailed code with explanations
6. **Tests** - What tests to write
7. **Definition of Done** - Checklist to verify completion

**Pro tip:** Read the code examples carefully. They show the *expected* implementation, not just pseudocode.

---

## How to Contribute

### Picking Up Work

Work can be assigned in different ways:

**Option 1: Own a Milestone**
- Pick an unstarted milestone
- Implement it completely
- Submit a PR for the entire milestone

**Option 2: Pick a Task**
- Look for tasks within a milestone
- Example: "Implement the `read` tool" within M5

**Option 3: Fix an Issue**
- Check GitHub issues
- Pick one labeled `good-first-issue`

### The PR Process

```
1. Create a branch
   git checkout -b feature/m5-tools

2. Make changes
   (implement, test, repeat)

3. Verify everything
   pnpm check

4. Commit with good messages
   git commit -m "feat(tools): implement read tool

   - Add file read capability with path validation
   - Apply labels based on file location
   - Add tests for edge cases

   Co-Authored-By: Your Name <your@email.com>"

5. Push and create PR
   git push origin feature/m5-tools
   gh pr create

6. Address review feedback

7. Merge!
```

### Commit Message Format

```
<type>(<scope>): <short description>

<longer description if needed>

Co-Authored-By: Your Name <your@email.com>
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code change that doesn't add features or fix bugs
- `test` - Adding tests
- `docs` - Documentation
- `chore` - Maintenance tasks

### What Makes a Good PR

✅ **Good PR:**
- Focuses on one thing
- Has tests
- Passes `pnpm check`
- Has clear description
- Links to milestone/issue

❌ **Avoid:**
- PRs that change everything
- Missing tests
- Mixing features with refactoring
- Vague descriptions

---

## Coding Standards

### TypeScript Rules

```typescript
// ✅ Use explicit types for function parameters and returns
function processMessage(content: string): ProcessResult {
  // ...
}

// ❌ Avoid 'any'
function process(data: any): any { }  // Bad!

// ✅ Use interfaces for objects
interface ToolResult {
  success: boolean
  output: string
  label: ContentLabel
}

// ✅ Use Zod for runtime validation
const ConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().min(1).max(65535).default(3000),
})
```

### Import Organization

```typescript
// 1. Node.js built-ins
import { randomUUID } from 'crypto'
import path from 'path'

// 2. External packages
import { z } from 'zod'

// 3. Internal modules (absolute)
import { AppConfig } from '../config'
import { AuditLogger } from '../audit'

// 4. Relative imports
import { processMessage } from './processor'
import { type MessageType } from './types'
```

### Error Handling

```typescript
// ✅ Use typed errors
class ConfigError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

// ✅ Catch specific errors
try {
  const config = await loadConfig()
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Config error in ${error.field}: ${error.message}`)
  } else {
    throw error  // Re-throw unknown errors
  }
}
```

### Async/Await

```typescript
// ✅ Use async/await, not callbacks or .then()
async function fetchData(url: string): Promise<Data> {
  const response = await fetch(url)
  return response.json()
}

// ✅ Handle multiple async operations properly
const [config, credentials] = await Promise.all([
  loadConfig(),
  loadCredentials(),
])
```

---

## Testing Requirements

### Test File Location

```
src/config/loader.ts      → test/config/loader.test.ts
src/tools/builtin/bash.ts → test/tools/builtin/bash.test.ts
```

### Writing Tests

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processMessage } from './processor'

describe('processMessage', () => {
  // Setup before each test
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test the happy path
  it('processes valid message', async () => {
    const result = await processMessage('hello')
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello')
  })

  // Test edge cases
  it('handles empty message', async () => {
    const result = await processMessage('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Message cannot be empty')
  })

  // Test error conditions
  it('throws on invalid input', async () => {
    await expect(processMessage(null as any))
      .rejects.toThrow('Invalid input')
  })
})
```

### Critical Tests

Some tests are **required** before any PR can merge:

```typescript
// This test MUST pass - it's a security requirement
describe('NEVER_LOG enforcement', () => {
  it('removes metadata.message.content even if caller provides it', () => {
    const entry = {
      category: 'channel',
      action: 'message_received',
      metadata: { message: { content: 'secret user message' } }
    }
    const sanitized = sanitizeAuditEntry(entry)
    // Path is 'metadata.message.content' - the metadata.* prefix is required
    expect(sanitized.metadata.message.content).toBeUndefined()
  })
})
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode (re-runs on changes)
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage

# Run specific test file
pnpm test src/config/loader.test.ts

# Run tests matching a pattern
pnpm test -t "NEVER_LOG"
```

---

## Security Principles

### The Golden Rules

1. **One Choke Point for Tools**
   - All tool calls go through `ToolExecutor`
   - Never bypass it, even for "safe" tools

2. **One Choke Point for Network**
   - All outbound requests go through `NetworkGuard`
   - DNS validation (IPv4 + IPv6), IP blocking, allowlists

3. **One Choke Point for Secrets**
   - All output goes through `SecretDetector`
   - Audit, tools, memory - all use the same detector

4. **One Choke Point for Audit**
   - All logging goes through `AuditLogger`
   - NEVER_LOG enforced here, cannot be bypassed

5. **NEVER_LOG Test Must Pass**
   - This test is a gate for all PRs
   - If it fails, the PR cannot merge

6. **Golden Path Test Must Pass**
   - End-to-end test of the main flow
   - Ensures everything works together

### Policy Enforcement Order

When evaluating tool actions, policies are checked in order. **Earlier layers cannot be bypassed by later layers.**

```
1. GLOBAL SECURITY POLICY (platform level - cannot be overridden)
   → Tool capabilities, sandbox enforcement, secret detection, NEVER_LOG

2. ORG/APP POLICY (deployment level)
   → Content labels, network allowlists, deny rules

3. AGENT AUTONOMY POLICY (agent-specific)
   → autoApprove/requireApproval rules, default = require approval

4. USER CONFIRMATION UX (runtime)
   → Display approval prompt, wait for user decision
```

**Key invariant:** Agent autonomy CANNOT override global/org policy. An agent saying `autoApprove: ['*']` still respects sandbox rules.

### When In Doubt

Ask yourself:
- "Could this expose user data?" → Use NEVER_LOG fields
- "Could this expose secrets?" → Run through SecretDetector
- "Could this cause harm?" → Require approval
- "Could this escape the sandbox?" → Add more isolation

---

## Common Patterns

### Singleton Pattern

Used for things that should only exist once:

```typescript
// src/security/secrets/detector.ts
class SecretDetector {
  scan(text: string): SecretFinding[] { /* ... */ }
  redact(text: string): { redacted: string; findings: SecretFinding[] } { /* ... */ }
}

// Export singleton instance - everyone uses the same one
export const secretDetector = new SecretDetector()
```

**Why?** Consistent behavior everywhere, shared state (like caches).

### Factory Pattern

Used to create instances based on configuration:

```typescript
// src/provider/adapter.ts
export async function createProvider(config: AppConfig): Promise<ProviderClient> {
  switch (config.providers.primary.type) {
    case 'anthropic':
      return new AnthropicProvider(config.providers.primary)
    case 'mock':
      return MockProvider.goldenPath()
    default:
      throw new Error(`Unknown provider: ${config.providers.primary.type}`)
  }
}
```

**Why?** Centralized creation logic, easy to add new types.

### Interface + Implementation Pattern

Used for things that can have multiple implementations:

```typescript
// Interface defines the contract
interface Channel {
  name: string
  initialize(): Promise<void>
  shutdown(): Promise<void>
  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse>): void
  requestApproval(request: ApprovalRequest): Promise<boolean>
  // Streaming support (implementation varies by channel)
  streamDelta(delta: string): void      // CLI: print immediately
  streamComplete(): void                 // Telegram: edit message with final content
  onToolCallStart(name: string): void
  onToolCallResult(name: string, success: boolean): void
}

// Multiple implementations
class CLIChannel implements Channel { /* ... */ }
class TelegramChannel implements Channel { /* ... */ }  // Buffers deltas, throttles edits
class WebSocketChannel implements Channel { /* ... */ }
```

**Why?** Swap implementations without changing code that uses them.

**Note:** Telegram can't truly stream, so it buffers deltas and edits the message every 500ms to avoid rate limits.

### Zod Schema Pattern

Used for validating external data:

```typescript
import { z } from 'zod'

// Define the schema
const ToolArgsSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).optional(),
})

// Infer the TypeScript type
type ToolArgs = z.infer<typeof ToolArgsSchema>

// Validate at runtime
function execute(rawArgs: unknown): void {
  const args = ToolArgsSchema.parse(rawArgs)  // Throws if invalid
  // args is now typed as ToolArgs
}
```

**Why?** TypeScript only validates at compile time. Zod validates at runtime.

---

## Troubleshooting

### Common Issues

**"Type error: Property X does not exist"**
```bash
# TypeScript cache might be stale
rm -rf node_modules/.cache
pnpm typecheck
```

**"Test fails locally but passes in CI"**
```bash
# Clear test cache
pnpm test --clearCache
```

**"pnpm install fails"**
```bash
# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

**"Docker sandbox fails"**
```bash
# Check Docker is running
docker ps

# Check the sandbox image exists
docker images | grep meao-sandbox
```

### Getting Help

1. **Check the design docs** - Most questions are answered there
2. **Read the milestone doc** - It has detailed implementation guides
3. **Search existing code** - Similar patterns likely exist
4. **Ask in the team chat** - If still stuck

---

## Resources

### Design Documents

| Document | What It Covers |
|----------|----------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design overview |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Master implementation plan |
| [CONFIG.md](./CONFIG.md) | Configuration system |
| [AUDIT.md](./AUDIT.md) | Audit logging |
| [SANDBOX.md](./SANDBOX.md) | Execution isolation |
| [TOOL_CAPABILITY.md](./TOOL_CAPABILITY.md) | Tool security policies |
| [LABELS.md](./LABELS.md) | Content labeling system |
| [SECRET_DETECTION.md](./SECRET_DETECTION.md) | Secret detection patterns |

### Milestone Documents

Located in `design/milestones/`:
- M0-repo-setup.md
- M1-config.md
- M1.5-audit-thin.md
- M2-security.md
- ... and so on

### External Resources

| Topic | Resource |
|-------|----------|
| TypeScript | [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/) |
| Zod | [Zod Documentation](https://zod.dev/) |
| Vitest | [Vitest Documentation](https://vitest.dev/) |
| Anthropic API | [Claude API Docs](https://docs.anthropic.com/) |
| Docker | [Docker Documentation](https://docs.docker.com/) |

---

## Your First Contribution

Ready to start? Here's a suggested path:

### Week 1: Understand
1. Read this entire document
2. Read ARCHITECTURE.md
3. Read IMPLEMENTATION.md (focus on the overview)
4. Set up your development environment
5. Run `pnpm check` successfully

### Week 2: Explore
1. Read M0 and M1 milestone docs
2. Look at the existing code (if any)
3. Run the tests, understand what they test
4. Make a tiny change (fix a typo, improve a comment)
5. Submit your first PR

### Week 3+: Build
1. Pick a milestone or task
2. Read the milestone doc thoroughly
3. Implement incrementally (small commits)
4. Ask questions early
5. Submit PR, iterate on feedback

---

**Welcome to the team!** We're excited to have you. Don't hesitate to ask questions - that's how we all learn.

---

*Last updated: 2026-01-29 (v1.2 - Added Phase 3/4 milestones, Policy Enforcement Order, M0 complete)*
