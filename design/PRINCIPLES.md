# Design Principles

These principles guide every architectural decision we make.

---

## From Reddit: "Peak Backend Architecture" Wisdom

The r/softwarearchitecture community has converged on pragmatic patterns. We adopt these:

### 1. Modular Monolith First

> "Refactoring a boundary inside a monolith is an IDE shortcut; refactoring it between services is a cross-team nightmare."

**Our approach:**
- Start as a single deployable unit
- Use clear module boundaries internally
- Only extract services if we hit specific pain points
- Don't prematurely distribute

### 2. Vertical Scaling is Underrated

> "A single compute can now run 1536 concurrent threads... Not only is this equivalent to 1536 computers of the past, but shared memory between threads is an enormous advantage."

**Our approach:**
- Don't assume we need horizontal scaling
- Modern hardware is incredibly powerful
- Shared memory > distributed message passing (for us)
- Simplicity wins

### 3. PostgreSQL for Everything

> "Most data is actually highly-relational in nature... If you're hell-bent on only using NoSQL, you end up piecing together a poor-man's version of SQL."

**Our approach:**
- PostgreSQL as primary data store
- Use its JSON capabilities for semi-structured data
- Redis only if we genuinely need caching
- Avoid NoSQL hype

### 4. Microservices are Organizational, Not Technical

> "We've finally admitted that Microservices are primarily an organizational tool. They solve the 'too many cooks' problem."

**Our approach:**
- We're one person (or a small team)
- We don't need organizational boundaries
- Monolith serves us perfectly
- Complexity is the enemy

### 5. The "Boring" Stack Wins

> "PostgreSQL, Redis, OpenTelemetry - the boring infrastructure."

**Our approach:**
- Choose proven, boring technologies
- Avoid shiny new things
- Prioritize reliability over novelty
- If it's been solving problems for 10+ years, it's probably good

---

## From Clawdbot: Security Lessons

Every vulnerability they had, we prevent:

### 1. Secure by Default

**Clawdbot's mistake:** Gateway was designed for local use but easily exposed to internet.

**Our principle:**
- Default to locked down
- Require explicit opt-in for any exposure
- Fail closed, not open
- If in doubt, deny

### 2. Never Trust External Input

**Clawdbot's mistake:** Prompt injection via emails/messages could steal data in 5 minutes.

**Our principle:**
- All external content is hostile
- Sanitize everything
- System prompt includes security rules
- Consider read-only agents for untrusted input

### 3. Encrypt Credentials at Rest

**Clawdbot's mistake:** Plaintext credentials in `~/.clawdbot/` were easy pickings for malware.

**Our principle:**
- Encrypt all stored credentials
- Use OS keychain where available
- Strict file permissions (600)
- Consider hardware security keys

### 4. Sandbox Tool Execution

**Clawdbot's mistake:** Tools ran with full user permissions by default.

**Our principle:**
- Docker sandbox by default
- Minimal capabilities
- Network isolation for untrusted code
- Approval gates for dangerous operations

### 5. No Untrusted Plugins

**Clawdbot's mistake:** ClawdHub had no moderation; poisoned skills were downloaded by developers.

**Our principle:**
- No external plugin marketplace
- All extensions are local/vetted
- Code review required for new tools
- If we need community plugins, strict allowlist only

### 6. Authentication Always Required

**Clawdbot's mistake:** Localhost connections auto-authenticated, proxies bypassed auth.

**Our principle:**
- Auth required even locally
- No proxy header trust by default
- Device pairing for new connections
- Timing-safe token comparison

---

## Our Own Principles

### 1. Personal First

This is YOUR assistant. Design for:
- Your workflows
- Your preferences
- Your security needs
- Your hardware

Don't over-generalize. Solve your problems well.

### 2. Understand Before Automating

> "The AI has shell access. Treat it like giving someone your unlocked computer."

Before letting the AI do something:
- Understand what it's doing
- Set clear boundaries
- Review periodically
- Don't blindly trust

### 3. Observability Over Obscurity

- Log everything (redacted appropriately)
- Make state inspectable
- Surface errors clearly
- Debug-friendly design

### 4. Progressive Complexity

Start simple, add complexity only when needed:

```
Phase 1: CLI + single channel + local only
Phase 2: Add more channels as needed
Phase 3: Remote access if required
Phase 4: Advanced features based on actual use
```

### 5. Exit Strategy

Design so you can:
- Export all your data easily
- Switch providers (AI, hosting, etc.)
- Understand and modify the code
- Shut down cleanly

---

## Anti-Principles (What We Avoid)

### Don't:
- Build for hypothetical scale
- Add features "just in case"
- Optimize prematurely
- Follow hype cycles
- Sacrifice security for convenience
- Trust defaults blindly
- Assume the AI is always right

### Watch Out For:
- Complexity creep
- Configuration sprawl
- Dependency bloat
- Security theater (looks secure but isn't)
- "Works on my machine" deployment

---

## Decision Framework

When facing an architectural choice, ask:

1. **What's the simplest thing that works?**
2. **What are the security implications?**
3. **Can I understand and maintain this?**
4. **What happens when it fails?**
5. **Am I solving a real problem or an imagined one?**

If unsure, choose the boring option.

---

*These principles are living - we'll update them as we learn.*
