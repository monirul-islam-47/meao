# MEAO Security & Reliability Checklist

This checklist maps security invariants to verification methods and test coverage.
Each item must pass before merging to main.

---

## A) Identity & Isolation (INV-5)

### A1. userId source of truth

* **Rule:** `userId` must come from session/auth context only (never from model/tool args).
* **Verify:** grep for `userId` assignment; ensure it's injected from runtime/session and not read from tool JSON.
* **Test:** attempt to pass `userId` in tool args; confirm it's ignored and the request uses the session user.
* **Location:** `src/orchestrator/orchestrator.ts`, `src/session/manager.ts`

### A2. userId required at *store* layer

* **Rule:** all store operations fail hard if `userId` is missing/empty.
* **Verify:** store methods throw `userId is required` on missing/empty.
* **Test:** call store/query with `""` and `undefined`, expect error.
* **Test file:** `test/memory/episodic/store.test.ts` - "INV-5: user data isolation"
* **Test file:** `test/memory/semantic/store.test.ts` - "INV-5: user data isolation"

### A3. No unscoped get/delete by ID

* **Rule:** no `get(id)` or `delete(id)` that bypasses user scope at Memory API level.
* **Verify:** only `get(userId, id)` / `delete(userId, id)` exist on Memory classes.
* **Test:** user A creates memory; user B tries to fetch/delete by ID → must fail.
* **Test file:** `test/memory/episodic/store.test.ts` - "getByUser/deleteByUser"
* **Test file:** `test/memory/semantic/store.test.ts` - "getByUser/deleteByUser"

### A4. Retention is per-user scoped

* **Rule:** episodic retention can't evict other users.
* **Verify:** retention calls are `count(userId)`, `getOldestIdsByUser(userId)`, `deleteManyByUser(userId, ids)`.
* **Test:** user A inserts N entries; user B inserts N entries; A eviction does not delete B's entries.
* **Location:** `src/memory/episodic/index.ts` - `enforceLimitForUser()`
* **Test file:** `test/memory/episodic/store.test.ts` - "deleteManyByUser only deletes entries belonging to specified user"

---

## B) Tool Execution & Egress (Enforcement pipeline)

### B1. Single tool enforcement choke point

* **Rule:** all tools execute via `ToolExecutor` (no direct `tool.execute()` calls anywhere).
* **Verify:** search for `execute(` / `tool.execute` usage; orchestrator routes through executor only.
* **Test:** add a dummy tool that would bypass approvals if called directly; ensure it can't be invoked without ToolExecutor.
* **Location:** `src/tools/executor.ts`, `src/orchestrator/orchestrator.ts`

### B2. Deny-by-default approvals

* **Rule:** default approval callback denies unless explicit approval is granted.
* **Verify:** `ApprovalManager` default returns `false`.
* **Test:** run any `ask` tool without approvals → expect denial.
* **Location:** `src/tools/approvals.ts`
* **Test file:** `test/tools/executor.test.ts` - "approval flow"

### B3. Args redaction before UI/log exposure

* **Rule:** tool args must be redacted before `tool_use` events are emitted.
* **Verify:** `redactArgsSecrets()` is applied to args before channel/log.
* **Test:** run a tool with a fake key in args; assert channel event contains `[REDACTED]`.
* **Location:** `src/orchestrator/orchestrator.ts`
* **Test file:** `test/security/abuse-prevention.test.ts`

### B4. Tool output is marked as DATA (prompt-injection hardening)

* **Rule:** tool outputs shown to the model are wrapped as DATA (delimiters or tool-channel isolation).
* **Verify:** `wrapToolOutput(tool.name, output)` is applied before tool result goes into the transcript.
* **Test:** tool returns `ignore previous instructions`; confirm model-visible transcript shows it within DATA wrapper.
* **Location:** `src/tools/executor.ts` - calls `wrapToolOutput()`
* **Test file:** `test/tools/executor.test.ts` - "executes tool successfully" (checks DATA markers)

### B5. Network guard enforcement

* **Rule:** all network actions go through the guard (no raw fetch without policy).
* **Verify:** `web_fetch` calls are pre-checked; no other net clients exist outside guard.
* **Test:** attempt `http://127.0.0.1` / metadata IP; must be blocked.
* **Location:** `src/security/network/guard.ts`
* **Test file:** `test/security/network/guard.test.ts`

### B6. Redirect safety

* **Rule:** redirects must be validated hop-by-hop (or disabled).
* **Verify:** `fetch` uses `redirect:"manual"` and each `Location` is re-checked.
* **Test:** allowed domain redirects to blocked domain; must fail.
* **Location:** `src/tools/builtin/web_fetch.ts`
* **Test file:** `test/tools/builtin/web_fetch.test.ts` - redirect tests

---

## C) Sandbox & Command Execution

### C1. Fail-closed container sandbox

* **Rule:** if tool requires container sandbox and Docker is unavailable, it fails unless explicit override.
* **Verify:** `allowContainerFallback` default false.
* **Test:** mock Docker unavailable; container-required tool must fail.
* **Location:** `src/sandbox/executor.ts`
* **Test file:** `test/sandbox/executor.test.ts`

### C2. workDir and timeout actually enforced

* **Rule:** `bash` tool passes and sandbox enforces `workDir` + `timeout`.
* **Verify:** `SandboxExecutor.execute(cmd, shell, {workDir, timeout})` is used.
* **Test:** set `timeout=10ms` on `sleep 1` → must terminate.
* **Location:** `src/sandbox/process.ts`
* **Test file:** `test/sandbox/process.test.ts`

### C3. workDir path traversal/symlink escape prevention

* **Rule:** workDir must resolve inside allowed root (realpath).
* **Verify:** sandbox resolves and checks final path.
* **Test:** workDir contains `../` or symlink out of root → must be rejected.
* **Location:** `src/tools/builtin/read.ts`, `src/tools/builtin/write.ts`
* **Test file:** `test/tools/builtin/read.test.ts` - path traversal tests

---

## D) Memory Safety (M10)

### D1. sanitizeForStorage boundary is mandatory

* **Rule:** all memory writes (episodic/semantic/working compaction) pass through `sanitizeForStorage`.
* **Verify:** no direct store writes without sanitization.
* **Test:** content containing control chars, role prefixes, jailbreak strings is sanitized.
* **Location:** `src/memory/episodic/index.ts`, `src/memory/semantic/index.ts`
* **Test file:** `test/security/sanitize/storage.test.ts`

### D2. Secrets redaction before persistence

* **Rule:** memory content is secret-redacted before storage.
* **Verify:** memory write path calls `secretDetector.redact()` after sanitization.
* **Test:** store a string containing an API key; DB snapshot should not contain the raw key.
* **Location:** `src/memory/episodic/index.ts` - `add()` method
* **Test file:** `test/memory/episodic/index.test.ts` - "redacts secrets from content"

### D3. Semantic confirmation audit logs are metadata-only

* **Rule:** semantic "userConfirmed" writes generate an audit event without content.
* **Verify:** audit payload includes IDs/reason, excludes memory text.
* **Test:** search logs for stored memory string; must not appear.
* **Location:** `src/memory/semantic/index.ts` - audit logging
* **Test file:** `test/memory/semantic/index.test.ts` - "trust promotion and audit"

### D4. Embeddings never enter the prompt context

* **Rule:** buildContext strips embeddings (or never includes them).
* **Verify:** returned context objects have no vectors / arrays of floats.
* **Test:** golden snapshot test: buildContext output has `embedding: []` or no embedding field.
* **Location:** `src/memory/manager.ts` - `buildContext()`
* **Test file:** `test/memory/manager.test.ts` - "strips embeddings from episodic results"

### D5. Trust promotion cannot be spoofed

* **Rule:** "userConfirmed" must only be set by real approval flow (not LLM/tool).
* **Verify:** confirmation comes from UI/session layer; not derived from model output.
* **Test:** model attempts to set `userConfirmed=true` in tool args → ignored/blocked.
* **Location:** Semantic memory write flow

---

## E) Labels & Flow Control

### E1. Labels propagate and influence decisions

* **Rule:** tool outputs have labels; labels impact whether subsequent risky tools can run.
* **Verify:** orchestrator checks label before allowing egress or write-to-semantic.
* **Test:** untrusted tool output cannot be written to semantic without confirmation.
* **Location:** `src/security/flow/control.ts`
* **Test file:** `test/security/flow/control.test.ts`

### E2. "Lowest trust + highest sensitivity wins"

* **Rule:** when combining data sources, output label is the worst-case combination.
* **Verify:** label propagation merges correctly.
* **Test:** combine verified + untrusted → result is untrusted; combine public + secret → result is secret.
* **Location:** `src/security/labels/propagation.ts`
* **Test file:** `test/security/labels/propagation.test.ts`

---

## F) Reliability / UX

### F1. Busy queue behavior is deterministic

* **Rule:** while processing, messages queue up to max and overflow fails predictably.
* **Verify:** queue exists; overflow response is explicit.
* **Test:** send > maxQueueSize messages rapidly; ensure ordering + clear overflow behavior.
* **Location:** `src/orchestrator/orchestrator.ts` - `handleIncomingMessage()`

### F2. Exactly-once tool execution (or idempotency keys)

* **Rule:** tool results must bind to a run/session id; stale tool results are rejected.
* **Verify:** tool calls carry run IDs.
* **Test:** replay a tool result from an older run; must be ignored.

---

## G) Docs & Ops Hygiene

### G1. Credentials file truth is consistent

* **Rule:** docs and code agree on `credentials.json` vs `credentials.enc` and encryption status.
* **Verify:** CONFIG + ARCHITECTURE + KEY_MANAGEMENT match code behavior.
* **Test:** install/run from scratch following docs; must work without surprises.
* **Status:** Currently `credentials.json` (plaintext), `credentials.enc` is planned future work.

### G2. Milestone status reflects implementation

* **Rule:** design milestone checklists match what's implemented.
* **Verify:** M10 marked done; tool/sandbox milestones updated appropriately.
* **Location:** `design/milestones/`

---

## "Must-pass" Test Suite Before Merging to Main

Run these tests to verify critical security invariants:

```bash
# Cross-user isolation (INV-5)
pnpm test test/memory/episodic/store.test.ts
pnpm test test/memory/semantic/store.test.ts

# Tool output injection protection
pnpm test test/tools/executor.test.ts
pnpm test test/security/abuse-prevention.test.ts

# Network guard and redirects
pnpm test test/security/network/guard.test.ts
pnpm test test/tools/builtin/web_fetch.test.ts

# Sandbox fail-closed
pnpm test test/sandbox/executor.test.ts

# Secrets never logged
pnpm test test/audit/never_log.test.ts
pnpm test test/security/never-log.test.ts

# Full security suite
pnpm test test/integration/security.test.ts
```

### Critical Invariants Summary

| ID | Invariant | Test Coverage |
|----|-----------|---------------|
| INV-5 | User A cannot access User B's data | `store.test.ts` - INV-5 describe block |
| INV-9 | Trust promotions are audited | `semantic/index.test.ts` - trust promotion tests |
| FC-2 | Untrusted → semantic requires confirmation | `flow/control.test.ts` |
| FC-3 | Secrets redacted from working memory | `episodic/index.test.ts`, `never_log.test.ts` |

---

## Known Limitations

### DNS TOCTOU Vulnerability

**Issue:** Time-of-check to time-of-use gap in DNS resolution allows bypass of IP-based network restrictions.

**Attack scenario:**
1. Attacker controls DNS for `evil.example.com`
2. First resolution (check) returns allowed IP `1.2.3.4`
3. Before fetch completes, DNS changes to `169.254.169.254` (metadata)
4. Fetch goes to metadata service, bypassing guard

**Current mitigations:**
- Localhost/metadata IPs blocked at URL parse time
- Short DNS TTLs reduce window
- Most cloud metadata services require headers

**Future fix:** Resolve DNS once, pin IP for the request duration using custom DNS resolver or connect-level IP validation.

See `design/SECURITY.md` for full details.
