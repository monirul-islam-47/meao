# Architecture Decision Records (ADR)

This document tracks all significant architectural decisions.

Format:
- **Decision**: What we decided
- **Context**: Why we needed to decide
- **Options**: What we considered
- **Rationale**: Why we chose this
- **Consequences**: What this means going forward

---

## Completed Decisions

### ADR-001: Platform Architecture (not Application)

**Status:** DECIDED - 2026-01-29

**Context:** Should we design for specific use cases (coding assistant, personal assistant) or build a general platform?

**Options:**
1. **Application approach** - Design features for specific use cases, bake in functionality
2. **Platform approach** - Build infrastructure, make everything pluggable

**Decision:** Platform architecture

**Rationale:**
- Channels, skills, and tools are "customer level choices" - they should sit on top of the platform, not inside it
- Clawdbot's tight coupling (gateway assumed specific channel behaviors) made security fixes harder
- A platform is more flexible for personal customization without needing to change core
- Clean interfaces between layers make security boundaries clearer

**Consequences:**
- Core is infrastructure only: Gateway, Auth, Storage, Sandbox
- All features are plugins: Channels, Skills, Tools
- Requires well-defined, stable interfaces between layers
- Initial development takes longer, but iteration is faster

---

### ADR-002: Three-Tier Memory Architecture

**Status:** DECIDED - 2026-01-29

**Context:** How should the AI remember things across conversations?

**Options:**
1. **Session only** - No memory between conversations
2. **Flat history** - Store all messages, search by keyword
3. **Vector-only** - Embed everything, retrieve by similarity
4. **Three-tier** - Working (session) + Episodic (history) + Semantic (knowledge)

**Decision:** Three-tier memory (Working, Episodic, Semantic)

**Rationale:**
- Mirrors human cognition: working memory, episodic memory, semantic memory
- Each tier has different storage and retrieval characteristics
- Working memory is fast (in-memory), episodic is searchable (vectors), semantic is structured (PostgreSQL)
- Preference learning fits naturally into semantic memory
- Research (Mem0, IBM, AWS) supports this pattern for AI agents

**Consequences:**
- Need vector storage (pgvector in PostgreSQL)
- Need embedding generation (OpenAI or local model)
- Memory retrieval becomes part of every AI call
- Preference engine extracts and applies learned preferences

---

### ADR-003: Three-Layer System Design

**Status:** DECIDED - 2026-01-29

**Context:** How to organize the codebase and responsibilities?

**Options:**
1. **Flat** - All code in one layer
2. **Two-layer** - Core + Plugins
3. **Three-layer** - Platform Core + Agent Core + Plugins
4. **Microservices** - Separate deployable services

**Decision:** Three-layer (Platform Core, Agent Core, Plugins)

**Rationale:**
```
┌─────────────────────────────────────────────────────────────┐
│  PLUGINS        Changes often, user-defined, isolated       │
├─────────────────────────────────────────────────────────────┤
│  AGENT CORE     AI logic, memory, orchestration            │
├─────────────────────────────────────────────────────────────┤
│  PLATFORM CORE  Boring infrastructure, rarely changes       │
└─────────────────────────────────────────────────────────────┘
```
- Clear separation of concerns
- Platform core is stable, secure, boring
- Agent core handles AI-specific logic
- Plugins are customizable without touching core
- Still a monolith (single deployment), just well-organized

**Consequences:**
- Well-defined interfaces between layers
- Platform core should be production-ready before adding features
- Plugins must conform to defined interfaces
- Testing can target each layer independently

---

### ADR-004: Boring Technology Stack

**Status:** DECIDED - 2026-01-29

**Context:** Which technologies to use?

**Decision:** Node.js 22+, TypeScript, PostgreSQL, Docker

| Layer | Component | Technology | Rationale |
|-------|-----------|------------|-----------|
| Platform | Runtime | Node.js 22+ | Mature async, proven |
| Platform | Language | TypeScript | Type safety |
| Platform | Database | PostgreSQL | The boring choice that works |
| Platform | Vectors | pgvector | Keep it in PostgreSQL |
| Platform | HTTP | Hono | Lightweight, fast |
| Platform | Validation | Zod | Type inference, great DX |
| Sandbox | Isolation | Docker | Industry standard |

**Rationale:**
- Reddit "Peak Backend Architecture" wisdom: boring stack wins
- PostgreSQL has been solving problems for 30+ years
- Node.js is mature and well-understood
- Avoid shiny new things that add complexity

**Consequences:**
- Not the fastest possible stack, but the most reliable
- Easier to find solutions to problems (mature ecosystem)
- pgvector means no separate vector database to manage

---

## Open Decisions

### ADR-005: Project Name

**Status:** DECIDED - 2026-01-29

**Context:** We need a name/codename for the project.

**Decision:** **meao**

**Rationale:**
- Short (4 characters) - easy to type
- Unique - no conflicts with existing projects
- Works as CLI command: `meao gateway start`
- Works as directory: `~/.meao/`

**Consequences:**
- CLI command: `meao`
- Config directory: `~/.meao/`
- Package name: `meao`

---

### ADR-006: First Channels

**Status:** DECIDED - 2026-01-29

**Context:** Which messaging platforms to support first?

**Decision:** **CLI first, then Telegram**

**Rationale:**
- CLI: Fastest iteration during development, no external dependencies
- Telegram: Best bot API, excellent grammY library, mobile access
- Both support our local-first architecture (Telegram uses long polling)

**Consequences:**
- Phase 1: Build CLI channel for development
- Phase 2: Add Telegram channel for mobile access
- Future: Discord, WhatsApp, Slack, etc. as plugins

---

### ADR-007: Hosting Strategy

**Status:** DECIDED - 2026-01-29

**Context:** Where will meao run? Need to balance security, ease of use, and accessibility.

**Decision:** **Multi-target local-first deployment**

Three supported deployment modes:
1. **User's machine** (Windows/Mac/Linux) - runs as background service
2. **Raspberry Pi / home server** - dedicated always-on device
3. **VPS** (optional, advanced) - for power users who prefer cloud

**Key Architecture Insight:**
Telegram/Discord/WhatsApp all support **long polling** (outbound connections only). This means:
- No port forwarding needed
- No tunneling required
- Works behind any NAT/firewall
- User messages bot from phone → bot (at home) receives via polling → responds

```
Phone (anywhere) ──► Telegram Servers ◄── meao (polling from home)
```

**Rationale:**
- Security: Gateway never exposed to internet by default
- Privacy: Data stays on user's hardware
- Easy: No networking setup for basic use
- Flexible: Power users can add Tailscale/Cloudflare Tunnel for remote CLI/web access
- Low cost: No cloud fees, just electricity (~$5/year for Raspberry Pi)

**For non-technical users (Windows/iPhone):**
- Install meao on Windows (one-click installer)
- Runs as Windows service (starts on boot, system tray)
- Add Telegram bot token via guided wizard
- Done - message bot from iPhone

**Consequences:**
- Must run as daemon/service on all platforms
- Must support ARM64 (Raspberry Pi)
- Must have low memory footprint
- Should handle sleep/wake gracefully (laptops)
- Optional: Pre-built Raspberry Pi image ("meao box")
- Optional: Tailscale integration for remote access

---

### ADR-008: AI Provider

**Status:** DECIDED - 2026-01-29

**Context:** Which AI model/provider to use?

**Decision:** **Anthropic Claude primary, with provider abstraction**

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                    Provider Manager                          │
├─────────────────────────────────────────────────────────────┤
│  Primary: Anthropic Claude                                  │
│    └─ Best for: Tool use, coding, complex reasoning         │
│                                                              │
│  Fallback: Ollama (local) - optional                        │
│    └─ Best for: Simple queries, offline mode                │
│                                                              │
│  Future: Per-skill routing                                  │
│    └─ Coding skill → Claude Opus                            │
│    └─ Quick questions → Local Llama                         │
└─────────────────────────────────────────────────────────────┘
```

**Rationale:**
- Claude has the best tool use capabilities
- Provider abstraction allows easy swapping/addition
- Local fallback enables offline mode and cost savings
- Per-skill routing enables cost optimization (cheap model for simple tasks)

**Consequences:**
- Build provider abstraction layer (not tied to Anthropic SDK directly)
- Support auth profile rotation with failover (like Clawdbot)
- Optional Ollama integration for local models
- Config allows specifying provider per skill

---

## Decision Log

| ID | Date | Decision | Status |
|----|------|----------|--------|
| 001 | 2026-01-29 | Platform Architecture | **Decided** |
| 002 | 2026-01-29 | Three-Tier Memory | **Decided** |
| 003 | 2026-01-29 | Three-Layer Design | **Decided** |
| 004 | 2026-01-29 | Boring Tech Stack | **Decided** |
| 005 | 2026-01-29 | Project Name (meao) | **Decided** |
| 006 | 2026-01-29 | First Channels (CLI + Telegram) | **Decided** |
| 007 | 2026-01-29 | Hosting Strategy (Multi-target local-first) | **Decided** |
| 008 | 2026-01-29 | AI Provider (Claude + abstraction) | **Decided** |
| 009 | 2026-01-29 | Autonomy Level (Ask for dangerous only) | **Decided** |
| 010 | 2026-01-29 | Multi-user (Single now, design for multi) | **Decided** |
| 011 | 2026-01-29 | Voice (None now, TTS later, STT if needed) | **Decided** |
| 012 | 2026-01-29 | UI (CLI → Web dashboard → System tray) | **Decided** |
| 013 | 2026-01-29 | Observability (Structured logs + audit, skip metrics) | **Decided** |
| 014 | 2026-01-29 | Backup (Export/import commands, user controls storage) | **Decided** |

---

### ADR-014: Backup Strategy

**Status:** DECIDED - 2026-01-29

**Context:** How should users backup their meao data?

**Decision:** **Easy export/import, user controls storage location**

```
MUST HAVE (Phase 1):
• meao backup export - creates encrypted backup file
• meao backup import - restore from backup
• Clear data directory structure (easy to backup externally)

NICE TO HAVE (Phase 2):
• Scheduled automatic backups
• Backup rotation (keep last N)
• Config versioning (track changes)

USER'S CHOICE:
• Cloud sync (user sets up rsync/rclone if wanted)
• Git for config (user can init git in ~/.meao)

DATA WE BACKUP:
• Config (settings, preferences)
• Sessions (conversation history)
• Memory (episodic + semantic)
• Credentials (encrypted)

DATA WE DON'T BACKUP:
• Logs (can regenerate)
• Cache (temporary)
```

**Rationale:**
- Simple export command lowers barrier to backup
- Encrypted exports are safe to store anywhere (cloud, USB, etc.)
- Users have different preferences for backup storage - don't force one
- Clear directory structure makes external backup tools easy

**Consequences:**
- Build `meao backup export` and `meao backup import` commands
- Encryption key derived from user password or separate backup key
- Document directory structure for power users who want custom backup

---

### ADR-013: Observability

**Status:** DECIDED - 2026-01-29

**Context:** What logging, monitoring, and debugging capabilities should meao have?

**Decision:** **Debug-friendly, security-conscious, not enterprise-level**

```
MUST HAVE (Phase 1):
• Structured JSON logs
• Configurable log levels (debug, info, warn, error)
• Automatic credential redaction (tokens, keys, passwords)
• File logging with rotation
• Audit log (tool executions, auth events, approvals)

NICE TO HAVE (Phase 2):
• Health endpoint (/health)
• Web dashboard log viewer
• Log search/filter

SKIP (unless needed):
• Prometheus metrics
• OpenTelemetry tracing
• Grafana dashboards
```

**Rationale:**
- Logs are essential for debugging
- Redaction is critical for security (lessons from Clawdbot)
- Audit trail important for understanding what AI did
- Enterprise monitoring (Prometheus, OpenTelemetry) is overkill for personal use
- Can always add later if demand arises

**Consequences:**
- Build logging infrastructure early
- Redaction must be baked in, not bolted on
- Audit log is separate from application log
- Design for log levels to reduce noise in production

---

### ADR-012: UI Preferences

**Status:** DECIDED - 2026-01-29

**Context:** What interfaces should meao provide?

**Decision:** **Progressive UI development**

```
Phase 1: CLI
  └─ Essential for dev and power users
  └─ meao gateway, meao chat, meao config, etc.

Phase 2: Web dashboard
  └─ Browser-based status, logs, chat
  └─ Connects via WebSocket
  └─ Universal access

Phase 3: System tray (if needed)
  └─ Electron/Tauri background indicator
  └─ Quick access menu
  └─ "meao is running" status

Future: Mobile app (only if needed)
  └─ Messaging channels (Telegram/Discord) ARE the mobile interface
  └─ Native app only if push notifications etc. become necessary
```

**Rationale:**
- CLI is essential and fast to build
- Web dashboard provides visual interface without native app complexity
- Users primarily interact via Telegram/Discord - that's the real UI
- Native apps are expensive to build and maintain, defer unless needed

**Consequences:**
- Build robust CLI from day one
- Web dashboard as second priority
- System tray nice-to-have for desktop users
- Design Gateway API to support all these clients

---

### ADR-011: Voice Capabilities

**Status:** DECIDED - 2026-01-29

**Context:** Should meao support voice input/output?

**Decision:** **Progressive voice support**

```
Phase 1 (Now): No voice
  └─ Focus on text-based messaging
  └─ Faster to build, simpler

Phase 2 (Mobile app): TTS only
  └─ Bot can speak responses
  └─ Telegram/Discord voice messages
  └─ Low effort, good UX improvement

Phase 3 (If needed): STT + TTS
  └─ Whisper API for transcription
  └─ Hands-free operation
  └─ Based on actual user demand
```

**Rationale:**
- Voice adds complexity without core value initially
- Text-based messaging covers primary use case
- TTS is low-hanging fruit when we build mobile app
- Wake word detection has privacy implications, skip unless demanded

**Consequences:**
- No voice in initial release
- Design message format to support voice notes (for future)
- Consider Whisper integration architecture for later

---

### ADR-010: Multi-user Support

**Status:** DECIDED - 2026-01-29

**Context:** Who will use meao - single user or multiple?

**Decision:** **Start single-user, architect for multi-user**

**Phases:**
```
Phase 1 (Now): Single user
  └─ One owner, simple auth
  └─ All data belongs to owner

Phase 2 (Future): Family/Friends
  └─ Multiple users via Telegram/Discord identity
  └─ Separate conversation histories
  └─ Per-user permissions (who can use which tools)
  └─ Shared vs private knowledge

Phase 3 (Future): Team/Work
  └─ Full multi-tenancy
  └─ Admin controls
  └─ Audit logging
  └─ Cost tracking per user
```

**Architecture implications (build now for later):**
```
┌─────────────────────────────────────────────────────────────┐
│                Design for Multi-user Now                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Sessions: user:{userId}:session:{sessionId}                │
│    └─ User context baked into session IDs                   │
│                                                              │
│  Memory: Scoped by user                                     │
│    └─ Episodic: per-user conversation history               │
│    └─ Semantic: shared knowledge + user preferences         │
│                                                              │
│  Permissions: Role-based (even if only "owner" for now)    │
│    └─ owner: full access                                    │
│    └─ user: configurable tool access                        │
│    └─ guest: read-only or limited                           │
│                                                              │
│  Identity: Abstract user identity                           │
│    └─ telegram:12345 → User                                 │
│    └─ discord:67890 → User                                  │
│    └─ Multiple channels can map to same User                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Rationale:**
- Single-user is simpler to build and test
- Designing with user isolation from the start avoids painful refactoring
- Family/friends and team use are realistic future scenarios
- Platform architecture already supports this thinking

**Consequences:**
- User ID is part of all data structures from day one
- Permissions system exists (even if minimal initially)
- Sessions, memories, preferences are user-scoped
- Channel identities map to abstract User entity

---

### ADR-009: Autonomy Level

**Status:** DECIDED - 2026-01-29

**Context:** How much should meao do without asking for permission?

**Decision:** **Ask for dangerous operations only**

**Tool Approval Policy:**
```
AUTO-APPROVE (no prompt):
• read - Read files
• web_fetch - Fetch URLs
• web_search - Search the web

ASK FIRST (requires approval):
• write - Create/overwrite files
• edit - Modify existing files
• bash - Execute shell commands
• send_message - Send messages on your behalf

ALWAYS ASK (dangerous patterns):
• delete - Delete files
• Commands matching: rm -rf, sudo, chmod 777, etc.
• Anything outside workspace
```

**Rationale:**
- Balance between convenience and safety
- Read-only operations are safe to auto-approve
- Write/execute operations need user awareness
- Dangerous patterns always require explicit approval
- User can customize (promote/demote tools in config)

**Consequences:**
- Build approval system with configurable policies
- Default to safe (ask) for new/unknown tools
- Support "trust this session" mode for power users
- Log all tool executions for audit trail

---

*Add new decisions as we encounter them.*
