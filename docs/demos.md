# MEAO Demo Workflows

These demos showcase MEAO's core capabilities in under 60 seconds each. Each workflow
validates a different aspect of the security-first architecture.

## Prerequisites

```bash
# Install dependencies
pnpm install

# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start MEAO
pnpm run start
```

---

## Demo 1: Golden Path (Provider + Web Fetch + Audit)

**Goal**: Validate the full request pipeline from provider to tool execution to audit.

### What It Demonstrates

- Provider integration with Anthropic API
- Tool calling with `web_fetch`
- Network allowlist enforcement
- Automatic audit logging
- Streaming response display

### Prompt

```
Fetch the README from https://raw.githubusercontent.com/lodash/lodash/main/README.md
and summarize the key features of lodash.
```

### Expected Behavior

1. Model decides to use `web_fetch` tool
2. Network guard allows `raw.githubusercontent.com` (in allowlist)
3. Content is fetched and returned to model
4. Model summarizes the content
5. Audit log captures: tool call, network access, response

### Verify

```bash
# Check audit log
cat ~/.meao/audit/*.jsonl | tail -5
```

---

## Demo 2: Repo Assistant (Read + Sandboxed Bash + Report)

**Goal**: Scan a local repository and generate a summary report.

### What It Demonstrates

- File reading with path security
- Sandboxed command execution
- Approval flow for bash commands
- Output sanitization (no secrets leaked)
- Multi-step tool orchestration

### Prompt

```
Scan this repository for TODO comments and list any failing tests.
Write a brief status report.
```

### Expected Behavior

1. Model uses `bash` to run `grep -r "TODO" .` (approval required)
2. After approval, command runs in sandbox
3. Model uses `bash` to run `pnpm test` (if tests exist)
4. Model summarizes findings
5. Optionally writes report with `write` tool

### Verify

```bash
# Approval was requested
grep "approval" ~/.meao/audit/*.jsonl | tail -3

# Bash was sandboxed
grep "sandbox" ~/.meao/audit/*.jsonl | tail -3
```

---

## Demo 3: Safe File Operations (Read + Transform + Write)

**Goal**: Read a file, transform it, and write output—all within security boundaries.

### What It Demonstrates

- Path traversal protection (can't escape workDir)
- Symlink escape prevention
- Secret redaction in outputs
- Approval flow for write operations
- Output labeling

### Prompt

```
Read package.json, extract the version number, and write it to version.txt
```

### Expected Behavior

1. Model uses `read` to get package.json content
2. Model extracts version field
3. Model uses `write` to create version.txt (approval required)
4. After approval, file is written
5. If any secrets were in the content, they're redacted

### Security Test (Optional)

Try these prompts to see security enforcement:

```
# This should be blocked (path traversal)
Read the file ../../etc/passwd

# This should be blocked (symlink escape)
Read the file link-to-outside  # (after creating a symlink)
```

### Verify

```bash
# Check the written file
cat version.txt

# Verify audit shows the write
grep "write" ~/.meao/audit/*.jsonl | tail -3
```

---

## Quick Reference: Demo Commands

Use the `meao demo` command for quick access:

```bash
# List all demos
meao demo list

# Show a specific demo prompt
meao demo show golden-path
meao demo show repo-assistant
meao demo show file-ops

# Run a demo interactively
meao demo run golden-path
```

---

## Understanding the Output

### Streaming Responses

MEAO streams responses token-by-token. You'll see:
- Text appearing incrementally
- Tool calls displayed as they're assembled
- Status indicators for tool execution

### Approval Prompts

When a tool requires approval, you'll see:
```
[?] Allow bash to execute: grep -r "TODO" .
    Reason: Command execution requires approval
    [y/n/always/never]:
```

Options:
- `y` - Approve this once
- `n` - Deny this request
- `always` - Approve this tool for the session
- `never` - Block this tool for the session

### Audit Trail

Every action is logged to `~/.meao/audit/`:
```json
{"ts":"...","level":"info","action":"tool:call","tool":"web_fetch","session":"..."}
{"ts":"...","level":"info","action":"tool:result","tool":"web_fetch","success":true}
```

---

## Troubleshooting

### "Network request blocked"
The URL isn't in the allowlist. Check `src/tools/builtin/web_fetch.ts` for allowed hosts.

### "Path outside working directory"
MEAO prevents file access outside the current directory. Use relative paths.

### "Sandbox execution failed"
Ensure Docker is running for container sandbox, or use process sandbox.

### "API key not found"
Set `ANTHROPIC_API_KEY` environment variable or add to `~/.meao/config.json`.
