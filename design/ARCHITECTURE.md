# meao - Platform Architecture

**Status:** ACTIVE - Core architectural vision
**Version:** 1.0
**Last Updated:** 2026-01-29

---

## Overview

**meao** is a personal AI platform that runs locally on your own hardware. It's a platform, not an application - channels, skills, and tools are plugins that sit on top of stable infrastructure.

```
┌─────────────────────────────────────────────────────────────────────┐
│                            meao                                      │
│                   Personal AI Platform                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Run locally on:     Your PC, Raspberry Pi, or VPS                 │
│   Talk via:           CLI, Telegram, Discord, (more later)          │
│   AI powered by:      Claude (with provider abstraction)            │
│   Data stays:         On YOUR hardware, encrypted                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Philosophy

This is a **platform**, not an application. The difference matters:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     APPLICATION THINKING                             │
│                                                                      │
│   "What features does it have?"                                     │
│   • Telegram bot                                                     │
│   • Code assistant                                                   │
│   • Calendar integration                                             │
│                                                                      │
│   Features are BUILT-IN. Adding new ones means changing core.       │
└─────────────────────────────────────────────────────────────────────┘

                              VS

┌─────────────────────────────────────────────────────────────────────┐
│                      PLATFORM THINKING                               │
│                                                                      │
│   "What can be built on it?"                                        │
│   • Any channel plugin                                               │
│   • Any skill plugin                                                 │
│   • Any tool plugin                                                  │
│                                                                      │
│   Features are PLUGGABLE. Core provides infrastructure only.        │
└─────────────────────────────────────────────────────────────────────┘
```

**Core insight:** Channels, skills, and tools are "customer level choices" - they sit on top of the platform, not inside it.

---

## Deployment Model

meao is designed to run on multiple targets, all using **local-first** architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    meao Deployment Options                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  OPTION A: Your Computer (Windows/Mac/Linux)                        │
│  ────────────────────────────────────────────                        │
│  • Runs as background service (starts on boot)                      │
│  • System tray indicator (optional)                                 │
│  • Works when computer is on                                        │
│                                                                      │
│  OPTION B: Raspberry Pi / Home Server                               │
│  ────────────────────────────────────────                            │
│  • Dedicated always-on device                                       │
│  • Low power (~5W = ~$5/year electricity)                          │
│  • Pre-built image available                                        │
│                                                                      │
│  OPTION C: VPS (Advanced)                                           │
│  ────────────────────────                                            │
│  • Cloud server (Hetzner, DigitalOcean, etc.)                      │
│  • Always on, accessible anywhere                                   │
│  • Monthly cost (~$5-10)                                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### How Remote Access Works (Without Port Forwarding)

Telegram, Discord, WhatsApp all support **long polling** - meao connects OUT to their servers:

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Your Phone    │         │    Telegram     │         │  meao (Home)    │
│   (anywhere)    │         │    Servers      │         │                 │
│                 │         │                 │         │                 │
│  Send message   │────────►│                 │◄────────│  Long polling   │
│                 │         │   (relays)      │         │  (outbound)     │
│  Get response   │◄────────│                 │────────►│                 │
│                 │         │                 │         │  Execute tools  │
└─────────────────┘         └─────────────────┘         └─────────────────┘

No port forwarding needed. No tunneling required. Just works.
```

---

## Three-Layer Architecture

```
╔═════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║                         PLUGINS LAYER                                ║
║                                                                      ║
║    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐          ║
║    │   CHANNELS   │   │    SKILLS    │   │    TOOLS     │          ║
║    │              │   │              │   │              │          ║
║    │  • CLI       │   │  • Coder     │   │  • bash      │          ║
║    │  • Telegram  │   │  • Research  │   │  • read      │          ║
║    │  • Discord   │   │  • Calendar  │   │  • write     │          ║
║    │  • (more)    │   │  • Custom    │   │  • web       │          ║
║    └──────┬───────┘   └──────┬───────┘   └──────┬───────┘          ║
║           │                  │                  │                   ║
║           └──────────────────┼──────────────────┘                   ║
║                              │                                       ║
╠══════════════════════════════╪══════════════════════════════════════╣
║                              ▼                                       ║
║                         AGENT CORE                                   ║
║                                                                      ║
║    ┌────────────────────────────────────────────────────────────┐   ║
║    │                     ORCHESTRATOR                            │   ║
║    │   Routes messages → Selects skills → Executes tools        │   ║
║    └────────────────────────────────────────────────────────────┘   ║
║                              │                                       ║
║    ┌─────────────────────────┼──────────────────────────────────┐   ║
║    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │   ║
║    │  │    MEMORY    │  │   PROVIDER   │  │  PREFERENCE  │     │   ║
║    │  │   MANAGER    │  │   MANAGER    │  │   ENGINE     │     │   ║
║    │  │              │  │              │  │              │     │   ║
║    │  │ • Working    │  │ • Anthropic  │  │ • Explicit   │     │   ║
║    │  │ • Episodic   │  │ • OpenAI     │  │ • Learned    │     │   ║
║    │  │ • Semantic   │  │ • Ollama     │  │ • Applied    │     │   ║
║    │  └──────────────┘  └──────────────┘  └──────────────┘     │   ║
║    └────────────────────────────────────────────────────────────┘   ║
║                              │                                       ║
╠══════════════════════════════╪══════════════════════════════════════╣
║                              ▼                                       ║
║                       PLATFORM CORE                                  ║
║                                                                      ║
║    ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ║
║    │  GATEWAY   │  │    AUTH    │  │   CONFIG   │  │   EVENTS   │  ║
║    │ WebSocket  │  │  Tokens    │  │  Zod/JSON  │  │  Pub/Sub   │  ║
║    └────────────┘  └────────────┘  └────────────┘  └────────────┘  ║
║                                                                      ║
║    ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ║
║    │  STORAGE   │  │  SANDBOX   │  │   CRYPTO   │  │    LOG     │  ║
║    │ PostgreSQL │  │  Docker    │  │  Encrypt   │  │  Redacted  │  ║
║    └────────────┘  └────────────┘  └────────────┘  └────────────┘  ║
║                                                                      ║
╚═════════════════════════════════════════════════════════════════════╝
```

---

## Layer Details

### Layer 1: Platform Core

**The foundation. Boring. Stable. Secure.**

| Component | Responsibility |
|-----------|----------------|
| **Gateway** | WebSocket server, HTTP endpoints, connection management, rate limiting |
| **Auth** | Token generation/validation, device pairing, timing-safe comparison |
| **Config** | Zod schema validation, hot reload, environment overrides, secure defaults |
| **Events** | Event bus (pub/sub), plugin lifecycle, async communication |
| **Storage** | PostgreSQL connection, migrations, query builder, transactions |
| **Sandbox** | Docker container management, resource limits, network isolation |
| **Crypto** | Credential encryption (AES-256-GCM), key management, secure random |
| **Log** | Structured JSON logging, automatic redaction, audit trail, rotation |

### Layer 2: Agent Core

**The AI brain. Memory. Orchestration. Intelligence.**

| Component | Responsibility |
|-----------|----------------|
| **Orchestrator** | Message routing, skill selection, context building, tool execution |
| **Memory Manager** | Working/Episodic/Semantic memory, retrieval strategies, context window |
| **Provider Manager** | AI provider abstraction, Anthropic/OpenAI/Ollama, streaming, failover |
| **Preference Engine** | Explicit preferences, learned patterns, application to prompts |

### Layer 3: Plugins

**The customization. User-controlled. Isolated. Swappable.**

| Type | Examples | Notes |
|------|----------|-------|
| **Channels** | CLI, Telegram, Discord, Web UI | Communication interfaces |
| **Skills** | Coder, Research, Calendar | Domain expertise with prompts + tools |
| **Tools** | bash, read, write, web_fetch | Atomic operations AI can perform |

---

## Memory Architecture

Three-tier memory system inspired by cognitive science:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                        WORKING MEMORY                                │
│                     (Active Conversation)                            │
│                                                                      │
│    • Current session context                                        │
│    • Last N messages                                                │
│    • Active task state                                              │
│    • Retrieved memories from below                                  │
│                                                                      │
│    Storage: In-memory          Lifetime: Session          Speed: ⚡  │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                              │ retrieval                            │
│                              ▼                                       │
│                       EPISODIC MEMORY                                │
│                    (Past Conversations)                              │
│                                                                      │
│    • "Remember when we debugged the auth issue?"                    │
│    • "Last time you asked about X, we did Y"                       │
│    • Past decisions and outcomes                                    │
│                                                                      │
│    Storage: pgvector + PostgreSQL     Retrieval: Semantic search    │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                              │ learning                             │
│                              ▼                                       │
│                       SEMANTIC MEMORY                                │
│                    (Knowledge & Preferences)                         │
│                                                                      │
│    • "User prefers TypeScript over JavaScript"                      │
│    • "User's project uses Hono, not Express"                       │
│    • "User likes concise responses"                                 │
│                                                                      │
│    Storage: PostgreSQL (structured)     Updates: Explicit + learned │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## AI Provider Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      PROVIDER MANAGER                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    PROVIDER ABSTRACTION                      │   │
│  │                                                              │   │
│  │   Common interface for all providers:                       │   │
│  │   • stream(messages, tools) → AsyncIterable<Event>          │   │
│  │   • countTokens(text) → number                              │   │
│  │   • embed(text) → number[]                                  │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼                    ▼                    ▼                 │
│  ┌────────────┐       ┌────────────┐       ┌────────────┐          │
│  │ Anthropic  │       │   OpenAI   │       │   Ollama   │          │
│  │  (Claude)  │       │  (GPT-4)   │       │  (Local)   │          │
│  │            │       │            │       │            │          │
│  │  PRIMARY   │       │  FALLBACK  │       │  OFFLINE   │          │
│  └────────────┘       └────────────┘       └────────────┘          │
│                                                                      │
│  Features:                                                          │
│  • Auth profile rotation with failover                             │
│  • Per-skill provider routing (future)                             │
│  • Automatic retry with backoff                                    │
│  • Token counting for context management                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tool Approval Policy

Balance between convenience and security:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      TOOL APPROVAL POLICY                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  AUTO-APPROVE (no user prompt):                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  • read         - Read files                                 │   │
│  │  • web_fetch    - Fetch URLs                                 │   │
│  │  • web_search   - Search the web                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ASK FIRST (requires approval):                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  • write        - Create/overwrite files                     │   │
│  │  • edit         - Modify existing files                      │   │
│  │  • bash         - Execute shell commands                     │   │
│  │  • send_message - Send messages on your behalf               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ALWAYS ASK (dangerous patterns):                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  • delete       - Delete files                               │   │
│  │  • rm -rf, sudo, chmod 777, etc.                            │   │
│  │  • Anything outside workspace                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  User configurable:                                                 │
│  • Promote/demote tools in config                                  │
│  • "Trust this session" mode for power users                       │
│  • Per-skill overrides                                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Multi-User Architecture

Designed for single-user now, but architected for multi-user later:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MULTI-USER DESIGN                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1 (Now): Single User                                        │
│  ─────────────────────────────                                       │
│  • One owner, simple auth                                           │
│  • All data belongs to owner                                        │
│  • Permissions system exists but defaults to "owner"               │
│                                                                      │
│  PHASE 2 (Future): Family/Friends                                   │
│  ─────────────────────────────────                                   │
│  • Multiple users via channel identity (telegram:123, discord:456) │
│  • Separate conversation histories                                  │
│  • Per-user tool permissions                                        │
│  • Shared vs private knowledge                                      │
│                                                                      │
│  PHASE 3 (Future): Team/Work                                        │
│  ───────────────────────────                                         │
│  • Full multi-tenancy                                               │
│  • Admin controls                                                   │
│  • Audit logging                                                    │
│  • Cost tracking per user                                           │
│                                                                      │
│  Built-in from day one:                                             │
│  ─────────────────────                                               │
│  • Session IDs: user:{userId}:session:{sessionId}                  │
│  • Memory scoped by user                                            │
│  • Abstract User entity (channel identities map to User)           │
│  • Role-based permissions (owner, user, guest)                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Security Architecture

Defense in depth - five independent layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 1: NETWORK                                                     │
│ • Default: Bind to localhost only (127.0.0.1)                       │
│ • Remote: Tailscale (recommended) or Cloudflare Tunnel             │
│ • NO direct internet exposure by default                           │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 2: AUTHENTICATION                                              │
│ • Token-based auth REQUIRED (even localhost)                        │
│ • Timing-safe comparison                                            │
│ • Device pairing for new clients                                    │
│ • NO auto-auth for localhost                                        │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 3: AUTHORIZATION                                               │
│ • DM policies (pairing, allowlist)                                  │
│ • Tool policies (allow/deny lists)                                  │
│ • Approval gates for dangerous operations                          │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 4: ISOLATION                                                   │
│ • Docker sandbox for command execution                              │
│ • Workspace path boundaries                                         │
│ • Network isolation in sandbox                                      │
│ • Resource limits (CPU, memory, time)                              │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 5: DATA PROTECTION                                             │
│ • Credentials encrypted at rest (AES-256-GCM)                      │
│ • File permissions: 600                                             │
│ • Automatic log redaction                                           │
│ • Audit trail for sensitive operations                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## User Interface Roadmap

Progressive UI development:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        UI ROADMAP                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1: CLI                                                       │
│  ─────────────                                                       │
│  • meao gateway start/stop                                          │
│  • meao chat "message"                                              │
│  • meao config get/set                                              │
│  • meao channels status                                             │
│  • Essential for dev and power users                                │
│                                                                      │
│  PHASE 2: Web Dashboard                                             │
│  ───────────────────────                                             │
│  • Browser-based status, logs, chat                                 │
│  • Connects via WebSocket                                           │
│  • Visual configuration                                             │
│                                                                      │
│  PHASE 3: System Tray (if needed)                                   │
│  ────────────────────────────────                                    │
│  • Electron/Tauri background indicator                              │
│  • Quick access menu                                                │
│  • "meao is running" status                                         │
│                                                                      │
│  KEY INSIGHT:                                                        │
│  Users primarily interact via Telegram/Discord.                     │
│  The messaging app IS the interface.                                │
│  Native apps only if push notifications etc. become necessary.     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Observability

Debug-friendly, security-conscious, not enterprise-level:

```
┌─────────────────────────────────────────────────────────────────────┐
│                       OBSERVABILITY                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  LOGGING                                                            │
│  ───────                                                             │
│  • Structured JSON logs                                             │
│  • Configurable levels (debug, info, warn, error)                  │
│  • Automatic credential redaction                                   │
│  • File logging with rotation                                       │
│                                                                      │
│  AUDIT TRAIL                                                        │
│  ───────────                                                         │
│  • Separate audit.log for security events                          │
│  • Tool executions with args (redacted)                            │
│  • Auth events (login, pairing, failures)                          │
│  • Approval requests and responses                                  │
│                                                                      │
│  HEALTH                                                             │
│  ──────                                                              │
│  • /health endpoint for status checks                              │
│  • Channel connection status                                        │
│  • Agent status                                                     │
│                                                                      │
│  NOT INCLUDED (unless needed):                                      │
│  • Prometheus metrics                                               │
│  • OpenTelemetry tracing                                            │
│  • Grafana dashboards                                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Backup & Recovery

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKUP STRATEGY                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  CLI COMMANDS                                                       │
│  ────────────                                                        │
│  • meao backup export → encrypted backup file                      │
│  • meao backup import → restore from backup                        │
│                                                                      │
│  WHAT WE BACKUP                                                     │
│  ───────────────                                                     │
│  • Config (settings, preferences)                                   │
│  • Sessions (conversation history)                                  │
│  • Memory (episodic + semantic)                                     │
│  • Credentials (encrypted)                                          │
│                                                                      │
│  WHAT WE DON'T BACKUP                                               │
│  ─────────────────────                                               │
│  • Logs (can regenerate)                                            │
│  • Cache (temporary)                                                │
│                                                                      │
│  USER'S CHOICE FOR STORAGE                                          │
│  ──────────────────────────                                          │
│  • Local folder                                                     │
│  • USB drive                                                        │
│  • Cloud (rsync/rclone)                                            │
│  • Git for config                                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Voice Capabilities (Future)

Progressive voice support:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     VOICE ROADMAP                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1 (Now): No Voice                                            │
│  • Focus on text-based messaging                                    │
│  • Simpler, faster to build                                         │
│                                                                      │
│  PHASE 2 (Mobile App): TTS Only                                     │
│  • Bot can speak responses                                          │
│  • Telegram/Discord voice messages                                  │
│  • Low effort, good UX improvement                                  │
│                                                                      │
│  PHASE 3 (If Needed): STT + TTS                                     │
│  • Whisper API for transcription                                    │
│  • Hands-free operation                                             │
│  • Based on user demand                                             │
│                                                                      │
│  SKIP: Wake word detection                                          │
│  • Privacy implications                                             │
│  • High complexity                                                  │
│  • Add only if strongly demanded                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
~/.meao/                             # Data directory
├── config.json                      # Main configuration
├── credentials.enc                  # Encrypted credentials
├── preferences.json                 # User preferences (semantic memory)
├── sessions/                        # Working memory (per session)
│   └── {user-id}/
│       └── {session-id}/
│           ├── messages.jsonl       # Conversation history
│           └── state.json           # Session state
├── memory/                          # Episodic memory
│   ├── embeddings/                  # Vector store (pgvector)
│   └── metadata.db                  # PostgreSQL
├── knowledge/                       # Semantic memory / knowledge base
│   └── {topic}/
│       └── *.md                     # Knowledge documents
├── logs/                            # Application logs
│   ├── app.log                      # Main log (rotated)
│   └── audit.log                    # Security audit trail
├── backups/                         # Local backups
│   └── meao-backup-{date}.enc
└── plugins/                         # Local plugin overrides
    ├── channels/
    ├── skills/
    └── tools/

/opt/meao/                           # Application (if installed system-wide)
├── bin/meao                         # CLI binary
├── lib/                             # Application code
└── plugins/                         # Built-in plugins
    ├── channels/
    │   ├── cli/
    │   └── telegram/
    ├── skills/
    │   └── coder/
    └── tools/
        ├── bash/
        ├── read/
        └── write/
```

---

## Technology Stack

| Layer | Component | Technology | Rationale |
|-------|-----------|------------|-----------|
| Platform | Runtime | Node.js 22+ | Mature async, ARM64 support |
| Platform | Language | TypeScript | Type safety, refactoring confidence |
| Platform | Database | PostgreSQL | The "boring" choice that works |
| Platform | Vectors | pgvector | Keep it in PostgreSQL |
| Platform | WebSocket | ws | Simple, proven |
| Platform | HTTP | Hono | Lightweight, fast, modern |
| Platform | Validation | Zod | Type inference, great DX |
| Agent | AI SDK | Anthropic SDK | Best tool use, direct control |
| Agent | Fallback | Ollama | Local models for offline/cheap |
| Agent | Embeddings | OpenAI / local | For semantic memory |
| Plugins | Telegram | grammY | Best TypeScript Telegram lib |
| Plugins | Discord | discord.js | Standard choice |
| Testing | Framework | Vitest | Fast, modern, ESM-native |
| Sandbox | Isolation | Docker | Industry standard |

---

## Design Principles

1. **Platform, not Application** - Core is infrastructure, features are plugins
2. **Local-First** - Data stays on user's hardware
3. **Boring Stack** - PostgreSQL, Node.js, Docker - proven technologies
4. **Security by Default** - Auth required, sandbox by default, encrypt secrets
5. **Memory as First-Class** - Three-tier memory is central to architecture
6. **Clean Interfaces** - Plugins have minimal, stable contracts
7. **Modular Monolith** - Single deployment, clear internal boundaries
8. **Design for Multi-User** - Even if single-user now

---

## Implementation Phases

```
┌─────────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION ROADMAP                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1: Foundation                                                │
│  • Project setup (TypeScript, ESM, pnpm)                           │
│  • Config system with Zod validation                                │
│  • Basic gateway server (WebSocket)                                 │
│  • Authentication (token-based)                                     │
│  • CLI skeleton                                                     │
│                                                                      │
│  PHASE 2: Agent Core                                                │
│  • Anthropic API integration                                        │
│  • Session management (JSONL)                                       │
│  • Basic tools (read, write, bash)                                 │
│  • Streaming responses                                              │
│  • Tool approval system                                             │
│                                                                      │
│  PHASE 3: First Channels                                            │
│  • CLI channel                                                      │
│  • Telegram channel (grammY)                                       │
│  • DM policy enforcement                                            │
│  • Message routing                                                  │
│                                                                      │
│  PHASE 4: Memory                                                    │
│  • PostgreSQL + pgvector setup                                     │
│  • Working memory (session)                                         │
│  • Episodic memory (search)                                        │
│  • Semantic memory (preferences)                                   │
│                                                                      │
│  PHASE 5: Security Hardening                                        │
│  • Credential encryption                                            │
│  • Docker sandboxing                                                │
│  • Security audit command                                           │
│  • Logging with redaction                                           │
│                                                                      │
│  PHASE 6: Polish                                                    │
│  • Hot-reload configuration                                         │
│  • Health monitoring                                                │
│  • Backup/restore                                                   │
│  • Web dashboard                                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Plugin Interfaces

### Channel Plugin

```typescript
interface ChannelPlugin {
  id: string           // "telegram", "cli", "discord"
  name: string         // "Telegram Bot"

  // Lifecycle
  start(config: ChannelConfig): Promise<void>
  stop(): Promise<void>
  healthCheck(): Promise<HealthStatus>

  // Core contract
  onMessage(handler: MessageHandler): void
  send(to: Recipient, message: OutgoingMessage): Promise<void>
}

interface NormalizedMessage {
  id: string
  channelId: string
  userId: string              // For multi-user
  senderId: string            // Platform-specific
  conversationId: string
  content: MessageContent
  timestamp: Date
  metadata: Record<string, unknown>
}
```

### Skill Plugin

```typescript
interface SkillPlugin {
  id: string              // "coder", "research"
  name: string            // "Coding Assistant"
  description: string     // For AI to understand when to use

  // Skill selection
  match(context: ConversationContext): SkillMatch

  // What this skill provides
  systemPrompt: string
  tools: ToolPlugin[]

  // Optional: skill-specific memory
  getMemory?(context: ConversationContext): Promise<Memory[]>
}
```

### Tool Plugin

```typescript
interface ToolPlugin {
  name: string           // "bash", "read"
  description: string    // For AI
  parameters: JSONSchema

  // Security policy
  policy: {
    approval: 'auto' | 'ask' | 'always'
    sandbox: boolean
    timeout?: number
    allowedPaths?: string[]
  }

  // Execution
  execute(args: Args, ctx: ToolContext): Promise<ToolResult>
}
```

---

*This architecture is living documentation - update as we build and learn.*

*Last updated: 2026-01-29*
