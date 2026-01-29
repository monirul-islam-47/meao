# meao - Personal AI Platform

This folder contains the living design documents for meao.

## Project Codename: **meao**

## Core Vision

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   This is a PLATFORM, not an application.                           │
│                                                                      │
│   • Channels (Telegram, Discord, CLI) are plugins                   │
│   • Skills (Coder, Research, Calendar) are plugins                  │
│   • Tools (bash, read, write) are plugins                           │
│                                                                      │
│   The core provides: security, memory, orchestration.               │
│   Everything else is customizable.                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Design Philosophy

Three pillars:

1. **Platform Architecture** - Clean layers, stable interfaces, pluggable everything
2. **Security First** - Learn from Clawdbot's mistakes, defense in depth
3. **Memory as Intelligence** - Three-tier memory (working, episodic, semantic)

## Document Index

### Core Architecture
| Document | Purpose | Status |
|----------|---------|--------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture with diagrams | **Active** |
| [PRINCIPLES.md](./PRINCIPLES.md) | Core design principles | Active |
| [DECISIONS.md](./DECISIONS.md) | Architecture Decision Records | Active |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Full implementation roadmap | **Active** |

### Security & Trust
| Document | Purpose | Status |
|----------|---------|--------|
| [SECURITY.md](./SECURITY.md) | Threat model, trust boundaries, invariants | **Active** |
| [LABELS.md](./LABELS.md) | Unified trust/sensitivity labeling system | **Active** |
| [SECRET_DETECTION.md](./SECRET_DETECTION.md) | Shared secret detection module | **Active** |
| [KEY_MANAGEMENT.md](./KEY_MANAGEMENT.md) | Encryption key hierarchy & rotation | **Active** |

### Execution & Isolation
| Document | Purpose | Status |
|----------|---------|--------|
| [TOOL_CAPABILITY.md](./TOOL_CAPABILITY.md) | Tool security policies & egress control | **Active** |
| [SANDBOX.md](./SANDBOX.md) | Container/process isolation, network proxy | **Active** |
| [MEMORY.md](./MEMORY.md) | Memory write/read rules, sanitization | **Active** |

### Interfaces & Contracts
| Document | Purpose | Status |
|----------|---------|--------|
| [INTERFACES.md](./INTERFACES.md) | Zod schemas for all plugins & types | **Active** |
| [AUDIT.md](./AUDIT.md) | Audit log schema, retention, alerting | **Active** |
| [API.md](./API.md) | Gateway HTTP/WebSocket protocol | **Active** |
| [CONFIG.md](./CONFIG.md) | Configuration schema, env vars, hot-reload | **Active** |

### Planned: Priority 2 (Important for Correctness)
| Document | Purpose | Why Important |
|----------|---------|---------------|
| PROVIDER.md | AI provider abstraction, failover, streaming | Core to agent functionality |
| ORCHESTRATOR.md | Message routing, skill selection, context building | The "brain" of the agent |
| APPROVAL.md | Approval flow UX, timeouts, persistence | Security depends on this working right |
| ERRORS.md | Error codes, user messages, recovery strategies | Consistent error handling |

### Planned: Priority 3 (Can Evolve During Implementation)
| Document | Purpose |
|----------|---------|
| CLI.md | All `meao` commands and flags |
| CHANNELS.md | Telegram/Discord/CLI specifics |
| PREFERENCES.md | Preference learning/storage/application |
| DEPLOYMENT.md | Docker, systemd, Windows service, Pi image |
| TESTING.md | Unit/integration/e2e/security test strategy |
| MIGRATION.md | Version upgrades, schema changes |

### Other
| Document | Purpose | Status |
|----------|---------|--------|
| [QUESTIONS.md](./QUESTIONS.md) | Open questions to decide | Active |

## Three-Layer Architecture

```
╔══════════════════════════════════════════════════════════════╗
║  PLUGINS         Channels │ Skills │ Tools                   ║
║                  (customizable, swappable, user-defined)     ║
╠══════════════════════════════════════════════════════════════╣
║  AGENT CORE      Orchestrator │ Memory │ Preferences         ║
║                  (the AI brain, context management)          ║
╠══════════════════════════════════════════════════════════════╣
║  PLATFORM CORE   Gateway │ Auth │ Storage │ Sandbox          ║
║                  (boring, stable, secure infrastructure)     ║
╚══════════════════════════════════════════════════════════════╝
```

## Memory Model

```
┌────────────────────────────────────────┐
│         WORKING MEMORY                 │  ← Current conversation
│         (session-scoped)               │
├────────────────────────────────────────┤
│         EPISODIC MEMORY                │  ← Past conversations
│         (vector similarity)            │    "Remember when..."
├────────────────────────────────────────┤
│         SEMANTIC MEMORY                │  ← Learned facts/prefs
│         (structured knowledge)         │    "User prefers X"
└────────────────────────────────────────┘
```

## Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Project Name | **meao** | Short, unique, easy to type |
| Architecture Style | Platform (not Application) | Channels/skills/tools are user choices |
| Memory Model | Three-tier (Working/Episodic/Semantic) | Mirrors human cognition |
| Plugin Design | Minimal stable interfaces | Clean contracts, easy to add/swap |
| Tech Stack | Boring (Node.js, PostgreSQL, Docker) | Proven, reliable |
| First Channels | CLI + Telegram | CLI for dev, Telegram for mobile |
| Hosting | Multi-target local-first | User's machine, Raspberry Pi, or VPS |

## Quick Links

- [Study materials](../study/) - Clawdbot research and learnings
- [Security guide](../CLAWDBOT_SECURITY_GUIDE.md) - What to avoid
- [Clawdbot source](../clawdbot/) - Reference implementation

## Next Steps

### Completed Design Documents
1. [x] Choose project codename → **meao**
2. [x] First channels → **CLI + Telegram**
3. [x] Hosting strategy → **Multi-target local-first**
4. [x] Security contract (threat model, invariants) → **SECURITY.md**
5. [x] Tool capability spec (data sensitivity, egress) → **TOOL_CAPABILITY.md**
6. [x] Memory spec (write/read rules, sanitization) → **MEMORY.md**
7. [x] Unified labeling system (trust + sensitivity) → **LABELS.md**
8. [x] Shared secret detection module → **SECRET_DETECTION.md**
9. [x] Key management plan (KEK/DEK, rotation, migration) → **KEY_MANAGEMENT.md**
10. [x] Sandbox specification (container, network proxy) → **SANDBOX.md**

### Remaining Design
11. [x] Plugin interface versioning → **INTERFACES.md** (versioning policy section)
12. [x] Define Zod schemas for plugin interfaces → **INTERFACES.md**
13. [x] Audit log schema specification → **AUDIT.md**
14. [x] Gateway API specification → **API.md**
15. [x] Configuration documentation → **CONFIG.md**
16. [ ] Custom seccomp/AppArmor profiles for sandbox

### Testing (Before Implementation)
14. [ ] Write end-to-end attack path tests:
    - [ ] Prompt injection chain (external content → tool execution)
    - [ ] `.env` read → attempted web POST (egress blocked)
    - [ ] Untrusted web → semantic memory write (requires confirmation)
    - [ ] bash network bypass attempts (container blocks)
    - [ ] DNS rebinding attack (proxy blocks)

### Implementation (MVP)
15. [x] Create implementation roadmap → **IMPLEMENTATION.md**
16. [ ] M0: Repository setup (build discipline)
17. [ ] M1: Config system + credentials
18. [ ] M1.5: Audit (thin logger + NEVER_LOG)
19. [ ] M2: Security primitives (SecretDetector, Labels)
20. [ ] M3: Audit (full - SecretDetector integration)
21. [ ] M4: Sandbox (process + container network=none)
22. [ ] M5: Tool system (registry + executor + builtins)
23. [ ] M6: CLI channel
24. [ ] M7: Provider (MockProvider + Anthropic)
25. [ ] M8: Orchestrator (golden path)

### Implementation (Phase 2+)
26. [ ] M9: Gateway (HTTP + WebSocket)
27. [ ] M10: Memory system
28. [ ] M11: Telegram channel

---

*Last updated: 2026-01-29* (added implementation roadmap)
