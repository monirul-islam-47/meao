# Milestone 5: Tool System

**Status:** NOT STARTED
**Scope:** MVP (read, write, web_fetch, bash). Edit is Phase 2.
**Dependencies:** M3 (Audit Full), M4 (Sandbox)
**PR:** PR5

---

## Goal

Implement the tool registry, capability enforcement pipeline, and builtin tools. This is where all security policies are enforced.

**Spec Reference:** [TOOL_CAPABILITY.md](../TOOL_CAPABILITY.md)

---

## File Structure

```
src/tools/
├── index.ts                   # Public exports
├── types.ts                   # ToolPlugin, ToolContext, ToolResult
├── registry.ts                # ToolRegistry class
├── capability.ts              # Capability schema + helpers
├── approvals.ts               # ApprovalManager
├── executor.ts                # ToolExecutor (enforcement pipeline)
├── audit.ts                   # Tool audit events
└── builtin/
    ├── index.ts               # Register all builtins
    ├── read.ts                # File read tool (MVP)
    ├── write.ts               # File write tool (MVP)
    ├── edit.ts                # File edit tool (PHASE 2)
    ├── bash.ts                # Shell execution tool (MVP)
    └── web_fetch.ts           # HTTP fetch tool (MVP)
```

---

## Key Exports

```typescript
// src/tools/index.ts
export { ToolRegistry } from './registry'
export { ToolExecutor } from './executor'
export { ApprovalManager } from './approvals'
export { type ToolPlugin, type ToolContext, type ToolResult } from './types'
export { registerBuiltinTools } from './builtin'
```

---

## Implementation Requirements

### 1. Types (types.ts)

```typescript
import { z } from 'zod'
import { ContentLabel } from '../security'
import { SandboxExecutor } from '../sandbox'
import { AuditLogger } from '../audit'

export interface ToolPlugin {
  name: string
  description: string
  parameters: z.ZodSchema
  capability: ToolCapability
  execute(args: unknown, context: ToolContext): Promise<ToolOutput>
}

export interface ToolContext {
  requestId: string
  sessionId: string
  userId: string
  workDir: string
  approvals: string[]
  sandbox: SandboxExecutor
  audit: AuditLogger
}

export interface ToolOutput {
  success: boolean
  output: string
  error?: string
}

export interface ToolResult {
  success: boolean
  output: string
  label: ContentLabel
  truncated: boolean
  executionTime: number
}

export interface ToolCapability {
  approval: {
    level: 'auto' | 'ask' | 'always_deny'
    dangerPatterns?: RegExp[]
    conditions?: {
      methodRequiresApproval?: string[]
      unknownHostRequiresApproval?: boolean
    }
  }
  execution?: {
    sandbox: 'none' | 'process' | 'container'
    networkDefault?: 'none' | 'proxy'
  }
  network?: {
    mode: 'none' | 'allowlist' | 'any'
    allowedHosts?: string[]
    blockedPorts?: number[]
    blockPrivateIPs?: boolean
    blockMetadataEndpoints?: boolean
  }
  labels?: {
    outputTrust?: 'untrusted' | 'verified' | 'user'
    outputDataClass?: 'public' | 'internal' | 'sensitive' | 'secret'
    acceptsUntrusted?: boolean
  }
  audit?: {
    logArgs?: boolean
    logOutput?: boolean
  }
}
```

### 2. Tool Registry (registry.ts)

```typescript
import { ToolPlugin } from './types'

export class ToolRegistry {
  private tools = new Map<string, ToolPlugin>()

  register(tool: ToolPlugin): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolPlugin | undefined {
    return this.tools.get(name)
  }

  getAll(): ToolPlugin[] {
    return Array.from(this.tools.values())
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    }))
  }
}
```

### 3. Approval Manager (approvals.ts)

```typescript
export interface ApprovalRequest {
  id: string
  tool: string
  action: string
  summary: string
  risks: string[]
  details?: Record<string, unknown>
}

export interface ApprovalHandler {
  request(approval: ApprovalRequest): Promise<boolean>
}

export class ApprovalManager {
  private handler: ApprovalHandler | null = null

  setHandler(handler: ApprovalHandler): void {
    this.handler = handler
  }

  async request(approval: ApprovalRequest): Promise<boolean> {
    if (!this.handler) {
      throw new Error('No approval handler set')
    }
    return this.handler.request(approval)
  }
}
```

### 4. Tool Executor (executor.ts)

The enforcement pipeline - **all tools flow through here**.

```typescript
import { ToolPlugin, ToolContext, ToolResult } from './types'
import { secretDetector, labelOutput } from '../security'
import { ApprovalManager } from './approvals'
import { getAuditLogger } from '../audit'

// Approval helpers
function hasApproval(context: ToolContext, id: string): boolean {
  return context.approvals.includes(id)
}

function addApproval(context: ToolContext, id: string): void {
  if (!hasApproval(context, id)) {
    context.approvals.push(id)
  }
}

export class ToolExecutor {
  constructor(private approvalManager: ApprovalManager) {}

  async execute(
    tool: ToolPlugin,
    args: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const audit = getAuditLogger()

    // 1. Validate arguments
    const validatedArgs = tool.parameters.parse(args)

    // 2. Compute required approvals
    const requiredApprovals = this.computeApprovals(tool, validatedArgs)

    // 3. Request missing approvals
    for (const approval of requiredApprovals) {
      if (!hasApproval(context, approval.id)) {
        const granted = await this.approvalManager.request(approval)
        if (!granted) {
          await audit.log('tool', 'tool_denied', {
            severity: 'warning',
            requestId: context.requestId,
            metadata: {
              tool: tool.name,
              reason: 'approval_denied',
              approvalId: approval.id,
            },
          })
          return {
            success: false,
            output: `Approval denied: ${approval.summary}`,
            label: { trustLevel: 'system', dataClass: 'public', source: { origin: 'system', timestamp: new Date() } },
            truncated: false,
            executionTime: 0,
          }
        }
        addApproval(context, approval.id)
      }
    }

    // 4. Enforce network rules (for web_fetch)
    if (tool.capability.network) {
      const networkResult = await this.enforceNetwork(tool, validatedArgs)
      if (!networkResult.allowed) {
        await audit.log('tool', 'network_blocked', {
          severity: 'warning',
          requestId: context.requestId,
          metadata: {
            tool: tool.name,
            reason: networkResult.reason,
          },
        })
        return {
          success: false,
          output: `Network blocked: ${networkResult.reason}`,
          label: { trustLevel: 'system', dataClass: 'public', source: { origin: 'system', timestamp: new Date() } },
          truncated: false,
          executionTime: 0,
        }
      }
    }

    // 5. Execute - tool.execute() does the work
    const startTime = Date.now()
    const rawOutput = await tool.execute(validatedArgs, context)

    // 6. Sanitize output
    const { redacted, findings } = secretDetector.redact(rawOutput.output)
    const maxOutput = 100000  // 100KB
    const truncated = redacted.length > maxOutput
    const sanitizedOutput = truncated ? redacted.slice(0, maxOutput) : redacted

    // 7. Apply labels
    const label = labelOutput(tool.capability.labels, findings)

    // 8. Emit audit event
    await audit.log('tool', 'tool_executed', {
      requestId: context.requestId,
      metadata: {
        tool: tool.name,
        success: rawOutput.success,
        executionTime: Date.now() - startTime,
        secretsFound: findings.length,
        truncated,
        // Note: output NOT logged per AUDIT.md
      },
    })

    return {
      success: rawOutput.success,
      output: sanitizedOutput,
      label,
      truncated,
      executionTime: Date.now() - startTime,
    }
  }

  private computeApprovals(tool: ToolPlugin, args: unknown): ApprovalRequest[] {
    const approvals: ApprovalRequest[] = []
    const cap = tool.capability

    // Always ask level
    if (cap.approval.level === 'ask') {
      approvals.push({
        id: `${tool.name}:execute`,
        tool: tool.name,
        action: 'execute',
        summary: `Execute ${tool.name}`,
        risks: [],
      })
    }

    // Danger patterns
    if (cap.approval.dangerPatterns && typeof args === 'object' && args) {
      const argsStr = JSON.stringify(args)
      for (const pattern of cap.approval.dangerPatterns) {
        if (pattern.test(argsStr)) {
          approvals.push({
            id: `${tool.name}:danger`,
            tool: tool.name,
            action: 'dangerous_operation',
            summary: `Potentially dangerous operation detected`,
            risks: ['Matches danger pattern'],
          })
          break
        }
      }
    }

    return approvals
  }

  private async enforceNetwork(
    tool: ToolPlugin,
    args: unknown
  ): Promise<{ allowed: boolean; reason?: string }> {
    const netCap = tool.capability.network
    if (!netCap) return { allowed: true }

    // Extract URL from args
    const url = (args as { url?: string }).url
    if (!url) return { allowed: true }

    const hostname = new URL(url).hostname

    // Check allowlist
    if (netCap.mode === 'allowlist' && netCap.allowedHosts) {
      const allowed = netCap.allowedHosts.some(pattern => {
        if (pattern.startsWith('*.')) {
          return hostname.endsWith(pattern.slice(1))
        }
        return hostname === pattern
      })
      if (!allowed) {
        return { allowed: false, reason: `Host not in allowlist: ${hostname}` }
      }
    }

    // DNS validation (imported from sandbox)
    const { resolveAndValidate } = await import('../sandbox')
    const dnsResult = await resolveAndValidate(hostname)
    if (!dnsResult.valid) {
      return { allowed: false, reason: dnsResult.reason }
    }

    return { allowed: true }
  }
}
```

### 5. Builtin Tools

#### web_fetch (builtin/web_fetch.ts)

```typescript
import { z } from 'zod'
import { ToolPlugin, ToolContext, ToolOutput } from '../types'

export const webFetchTool: ToolPlugin = {
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
      level: 'auto',
      conditions: {
        methodRequiresApproval: ['POST', 'PUT', 'DELETE'],
        unknownHostRequiresApproval: true,
      },
    },
    network: {
      mode: 'allowlist',
      allowedHosts: [
        '*.github.com',
        '*.npmjs.com',
        '*.npmjs.org',
        '*.stackoverflow.com',
      ],
      blockedPorts: [22, 23, 25, 3389],
      blockPrivateIPs: true,
      blockMetadataEndpoints: true,
    },
    labels: {
      outputTrust: 'untrusted',
      outputDataClass: 'internal',
      acceptsUntrusted: false,
    },
    audit: {
      logArgs: true,
      logOutput: false,  // NEVER log page content
    },
  },
  async execute(args, context): Promise<ToolOutput> {
    const { url, method, headers, body } = args as {
      url: string
      method: string
      headers?: Record<string, string>
      body?: string
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
      })

      const text = await response.text()

      return {
        success: response.ok,
        output: text,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      }
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
}
```

#### bash (builtin/bash.ts)

```typescript
import { z } from 'zod'
import { ToolPlugin, ToolContext, ToolOutput } from '../types'

export const bashTool: ToolPlugin = {
  name: 'bash',
  description: 'Execute shell commands in a sandboxed container',
  parameters: z.object({
    command: z.string(),
    workDir: z.string().optional(),
    timeout: z.number().optional(),
  }),
  capability: {
    approval: {
      level: 'ask',
      dangerPatterns: [
        /rm\s+-rf/,
        />\s*\/dev\/sd/,
        /mkfs/,
        /dd\s+if=/,
        /chmod\s+777/,
        /curl.*\|\s*sh/,
        /wget.*\|\s*sh/,
      ],
    },
    execution: {
      sandbox: 'container',
      networkDefault: 'none',
    },
    labels: {
      outputTrust: 'user',  // Not 'verified' - output can contain untrusted content
      outputDataClass: 'internal',
    },
    audit: {
      logArgs: true,
      logOutput: false,
    },
  },
  async execute(args, context): Promise<ToolOutput> {
    const { command, workDir, timeout } = args as {
      command: string
      workDir?: string
      timeout?: number
    }

    const result = await context.sandbox.runContainer({
      command,
      workDir: workDir ?? context.workDir,
      timeout: timeout ?? 120000,
      maxOutputSize: 100000,
      memory: '512m',
      cpus: 1,
      pidsLimit: 100,
      networkMode: 'none',
    })

    return {
      success: result.success,
      output: result.stdout + (result.stderr ? `\nSTDERR:\n${result.stderr}` : ''),
      error: result.success ? undefined : `Exit code: ${result.exitCode}`,
    }
  },
}
```

#### read (builtin/read.ts)

```typescript
import { z } from 'zod'
import { promises as fs } from 'fs'
import path from 'path'
import { ToolPlugin, ToolOutput } from '../types'

export const readTool: ToolPlugin = {
  name: 'read',
  description: 'Read a file from the filesystem',
  parameters: z.object({
    path: z.string(),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  }),
  capability: {
    approval: { level: 'auto' },
    execution: { sandbox: 'process' },
    labels: {
      outputTrust: 'verified',
      outputDataClass: 'internal',
    },
    audit: {
      logArgs: true,
      logOutput: false,  // Don't log file contents
    },
  },
  async execute(args, context): Promise<ToolOutput> {
    const { path: filePath, encoding } = args as { path: string; encoding: string }

    // Resolve path relative to workDir
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workDir, filePath)

    try {
      const content = await fs.readFile(resolvedPath, encoding as BufferEncoding)
      return { success: true, output: content }
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
}
```

---

## Tests

```
test/tools/
├── registry.test.ts
├── executor.test.ts
├── approvals.test.ts
├── builtin/
│   ├── read.test.ts
│   ├── write.test.ts
│   ├── bash.test.ts
│   └── web_fetch.test.ts
└── integration.test.ts
```

### Critical Test Cases

```typescript
// test/tools/builtin/web_fetch.test.ts
describe('web_fetch', () => {
  it('auto-approves GET to allowed host', async () => {
    // Should not require approval
  })

  it('requires approval for POST', async () => {
    // Should require approval
  })

  it('requires approval for unknown host', async () => {
    // example.com not in allowlist
  })

  it('labels output as untrusted', async () => {
    const result = await executor.execute(webFetchTool, { url: '...' }, context)
    expect(result.label.trustLevel).toBe('untrusted')
  })
})

// test/tools/executor.test.ts
describe('ToolExecutor', () => {
  it('sanitizes output through secretDetector', async () => {
    // Mock tool that returns a secret
    const result = await executor.execute(mockTool, args, context)
    expect(result.output).toContain('[REDACTED:')
  })

  it('does not log output in audit', async () => {
    await executor.execute(tool, args, context)
    const entries = await getAuditEntries()
    expect(entries[0].metadata?.output).toBeUndefined()
  })
})
```

---

## Definition of Done

- [ ] ToolRegistry registers and retrieves tools
- [ ] ToolExecutor implements full enforcement pipeline
- [ ] ApprovalManager handles approval requests
- [ ] web_fetch: allowlist, DNS validation, output labeled untrusted
- [ ] bash: container sandbox, network=none, output labeled user
- [ ] read/write: process sandbox, path validation
- [ ] All outputs sanitized through secretDetector
- [ ] Audit events emitted without content
- [ ] All tests pass
- [ ] `pnpm check` passes

---

## Next Milestone

After completing M5, proceed to [M6: CLI Channel](./M6-cli.md).

---

*Last updated: 2026-01-29*
