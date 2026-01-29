# Milestone 4: Sandbox System

**Status:** COMPLETE
**Scope:** MVP (process + container with network=none). Proxy egress is Phase 3.
**Dependencies:** M3 (Audit Full)
**PR:** PR6

---

## Goal

Implement process and container isolation for tool execution. The key invariant: **bash always runs in a container with --network=none**.

**Spec Reference:** [SANDBOX.md](../SANDBOX.md)

---

## File Structure

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
│   ├── modes.ts               # Network mode selection (MVP: always none)
│   └── dns.ts                 # DNS rebinding protection (for web_fetch)
├── executor.ts                # Unified execution interface
└── audit.ts                   # Sandbox audit events
```

---

## Key Exports

```typescript
// src/sandbox/index.ts
export { SandboxExecutor } from './executor'
export { type SandboxLevel, type NetworkMode, type ExecutionResult } from './types'
export { ProcessSandbox } from './process'
export { ContainerSandbox } from './container'
export { resolveAndValidate, isPrivateIP, isMetadataIP } from './network/dns'
```

---

## Implementation Requirements

### 1. Types (types.ts)

```typescript
export type SandboxLevel = 'none' | 'process' | 'container'
export type NetworkMode = 'none' | 'proxy' | 'host'

export interface ExecutionResult {
  success: boolean
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
  duration: number
}

export interface ProcessConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  workDir: string
  timeout: number
  maxOutputSize: number
  allowedPaths?: string[]
  blockedPaths?: string[]
}

export interface ContainerConfig extends ProcessConfig {
  image: string
  memory: string
  cpus: number
  pidsLimit: number
  networkMode: NetworkMode
}

// Default sandbox levels by tool
export const DEFAULT_SANDBOX_LEVELS: Record<string, SandboxLevel> = {
  read: 'process',
  write: 'process',
  edit: 'process',
  web_fetch: 'process',
  bash: 'container',
  python: 'container',
  node: 'container',
}
```

### 2. Process Sandbox (process.ts)

```typescript
import { spawn } from 'child_process'
import { ProcessConfig, ExecutionResult } from './types'

export class ProcessSandbox {
  async execute(config: ProcessConfig): Promise<ExecutionResult> {
    const startTime = Date.now()

    // Build clean environment
    const env = this.buildCleanEnv(config.env)

    return new Promise((resolve) => {
      const child = spawn(config.command, config.args ?? [], {
        env,
        cwd: config.workDir,
        timeout: config.timeout,
        shell: true,
      })

      let stdout = ''
      let stderr = ''
      let truncated = false

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        if (stdout.length + chunk.length > config.maxOutputSize) {
          stdout += chunk.slice(0, config.maxOutputSize - stdout.length)
          truncated = true
        } else {
          stdout += chunk
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        if (stderr.length + chunk.length > config.maxOutputSize) {
          stderr += chunk.slice(0, config.maxOutputSize - stderr.length)
          truncated = true
        } else {
          stderr += chunk
        }
      })

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          exitCode: code ?? -1,
          stdout,
          stderr,
          truncated,
          duration: Date.now() - startTime,
        })
      })

      child.on('error', (err) => {
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: err.message,
          truncated,
          duration: Date.now() - startTime,
        })
      })
    })
  }

  private buildCleanEnv(custom?: Record<string, string>): Record<string, string> {
    // Start with minimal safe environment
    const env: Record<string, string> = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      LANG: 'en_US.UTF-8',
    }

    // Add custom env vars
    if (custom) {
      Object.assign(env, custom)
    }

    return env
  }
}
```

### 3. Container Sandbox (container/docker.ts)

```typescript
import { spawn } from 'child_process'
import { ContainerConfig, ExecutionResult } from '../types'

export class ContainerSandbox {
  async execute(config: ContainerConfig): Promise<ExecutionResult> {
    const args = this.buildDockerArgs(config)
    const startTime = Date.now()

    return new Promise((resolve) => {
      const child = spawn('docker', args, {
        timeout: config.timeout,
      })

      let stdout = ''
      let stderr = ''
      let truncated = false

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        if (stdout.length + chunk.length > config.maxOutputSize) {
          stdout += chunk.slice(0, config.maxOutputSize - stdout.length)
          truncated = true
        } else {
          stdout += chunk
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          exitCode: code ?? -1,
          stdout,
          stderr,
          truncated,
          duration: Date.now() - startTime,
        })
      })

      child.on('error', (err) => {
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: err.message,
          truncated,
          duration: Date.now() - startTime,
        })
      })
    })
  }

  private buildDockerArgs(config: ContainerConfig): string[] {
    return [
      'run',
      '--rm',                              // Remove container after exit
      '--network=none',                    // MVP: ALWAYS no network
      '--read-only',                       // Read-only root filesystem
      '--cap-drop=ALL',                    // Drop all capabilities
      '--user=nobody',                     // Non-root user
      `--memory=${config.memory}`,         // Memory limit
      `--cpus=${config.cpus}`,             // CPU limit
      `--pids-limit=${config.pidsLimit}`,  // Process limit
      '-v', `${config.workDir}:/workspace:rw`,
      '-w', '/workspace',
      config.image,
      '/bin/sh', '-c', config.command,
    ]
  }
}
```

### 4. DNS Rebinding Protection (network/dns.ts)

Used by web_fetch to validate URLs before connecting.

```typescript
import dns from 'dns/promises'
import { URL } from 'url'

export interface ResolveResult {
  valid: boolean
  addresses?: string[]
  reason?: string
}

// Private IP ranges
const PRIVATE_RANGES = [
  /^10\./,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 172.16.0.0/12
  /^192\.168\./,              // 192.168.0.0/16
  /^127\./,                   // Loopback
  /^0\./,                     // Current network
  /^169\.254\./,              // Link-local
]

// Metadata endpoint
const METADATA_IPS = [
  '169.254.169.254',  // AWS/GCP/Azure metadata
  'fd00:ec2::254',    // AWS IPv6 metadata
]

export function isPrivateIP(ip: string): boolean {
  return PRIVATE_RANGES.some(range => range.test(ip))
}

export function isMetadataIP(ip: string): boolean {
  return METADATA_IPS.includes(ip)
}

export function isLoopback(ip: string): boolean {
  return ip.startsWith('127.') || ip === '::1'
}

export async function resolveAndValidate(hostname: string): Promise<ResolveResult> {
  try {
    const addresses = await dns.resolve4(hostname)

    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        return { valid: false, reason: `Private IP blocked: ${addr}` }
      }
      if (isMetadataIP(addr)) {
        return { valid: false, reason: `Metadata endpoint blocked: ${addr}` }
      }
      if (isLoopback(addr)) {
        return { valid: false, reason: `Loopback blocked: ${addr}` }
      }
    }

    return { valid: true, addresses }
  } catch (err) {
    return { valid: false, reason: `DNS resolution failed: ${err}` }
  }
}

// Validate redirect target (must re-resolve)
export async function validateRedirect(
  originalUrl: string,
  redirectUrl: string
): Promise<ResolveResult> {
  const redirectHost = new URL(redirectUrl).hostname
  return resolveAndValidate(redirectHost)
}
```

### 5. Unified Executor (executor.ts)

```typescript
import { ProcessSandbox } from './process'
import { ContainerSandbox } from './container'
import { SandboxLevel, ExecutionResult, ProcessConfig, ContainerConfig } from './types'
import { getAuditLogger } from '../audit'

export class SandboxExecutor {
  private processSandbox = new ProcessSandbox()
  private containerSandbox = new ContainerSandbox()
  private audit = getAuditLogger()

  async execute(
    level: SandboxLevel,
    config: ProcessConfig | ContainerConfig
  ): Promise<ExecutionResult> {
    const startTime = Date.now()

    try {
      let result: ExecutionResult

      switch (level) {
        case 'none':
          // Direct execution (dangerous, should rarely be used)
          result = await this.processSandbox.execute(config)
          break

        case 'process':
          result = await this.processSandbox.execute(config)
          break

        case 'container':
          result = await this.containerSandbox.execute(config as ContainerConfig)
          break

        default:
          throw new Error(`Unknown sandbox level: ${level}`)
      }

      // Audit success
      await this.audit.log('sandbox', 'execution_complete', {
        metadata: {
          level,
          exitCode: result.exitCode,
          duration: result.duration,
          truncated: result.truncated,
          // Note: output NOT logged
        },
      })

      return result

    } catch (err) {
      // Audit failure
      await this.audit.log('sandbox', 'execution_failed', {
        severity: 'alert',
        metadata: {
          level,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      })

      throw err
    }
  }

  // Convenience method for container execution
  async runContainer(config: Omit<ContainerConfig, 'image'>): Promise<ExecutionResult> {
    const fullConfig: ContainerConfig = {
      ...config,
      image: 'meao-sandbox:latest',
      memory: config.memory ?? '512m',
      cpus: config.cpus ?? 1,
      pidsLimit: config.pidsLimit ?? 100,
      networkMode: 'none',  // MVP: always none
    }

    return this.execute('container', fullConfig)
  }
}
```

---

## Tests

```
test/sandbox/
├── process.test.ts            # Process sandbox
├── container.test.ts          # Container sandbox
├── network/
│   └── dns.test.ts            # DNS rebinding protection
└── executor.test.ts           # Unified executor
```

### Critical Test Cases

```typescript
// test/sandbox/container.test.ts
describe('ContainerSandbox', () => {
  it('always uses --network=none', async () => {
    // Mock docker spawn to capture args
    const sandbox = new ContainerSandbox()
    const args = sandbox['buildDockerArgs']({
      command: 'echo test',
      workDir: '/tmp',
      timeout: 5000,
      maxOutputSize: 10000,
      image: 'alpine',
      memory: '256m',
      cpus: 0.5,
      pidsLimit: 50,
      networkMode: 'none',
    })

    expect(args).toContain('--network=none')
  })

  it('drops all capabilities', async () => {
    const sandbox = new ContainerSandbox()
    const args = sandbox['buildDockerArgs']({ /* ... */ })
    expect(args).toContain('--cap-drop=ALL')
  })

  it('runs as non-root', async () => {
    const sandbox = new ContainerSandbox()
    const args = sandbox['buildDockerArgs']({ /* ... */ })
    expect(args).toContain('--user=nobody')
  })
})

// test/sandbox/network/dns.test.ts
describe('DNS rebinding protection', () => {
  it('blocks private IP 10.x.x.x', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true)
    expect(isPrivateIP('10.255.255.255')).toBe(true)
  })

  it('blocks private IP 172.16-31.x.x', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true)
    expect(isPrivateIP('172.31.255.255')).toBe(true)
    expect(isPrivateIP('172.15.0.1')).toBe(false)
    expect(isPrivateIP('172.32.0.1')).toBe(false)
  })

  it('blocks private IP 192.168.x.x', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true)
    expect(isPrivateIP('192.167.0.1')).toBe(false)
  })

  it('blocks metadata endpoint', () => {
    expect(isMetadataIP('169.254.169.254')).toBe(true)
  })

  it('blocks localhost', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('127.0.0.2')).toBe(true)
  })

  it('allows public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)
    expect(isPrivateIP('1.1.1.1')).toBe(false)
  })
})
```

---

## Definition of Done

**MVP (must complete):**
- [ ] ProcessSandbox enforces clean env, timeout, output limits
- [ ] ContainerSandbox ALWAYS uses `--network=none`
- [ ] ContainerSandbox applies hardening (cap-drop, non-root, read-only)
- [ ] DNS rebinding protection blocks private/metadata IPs
- [ ] Audit events emitted for sandbox operations
- [ ] All tests pass
- [ ] `pnpm check` passes

**Phase 3 (defer):**
- [ ] Proxy egress mode via HTTP_PROXY
- [ ] Network mode upgrade with approval flow

---

## PR Checklist

```markdown
## PR6: Sandbox System

### Changes
- [ ] Implement ProcessSandbox
- [ ] Implement ContainerSandbox (always network=none)
- [ ] Implement DNS rebinding protection
- [ ] Add SandboxExecutor

### Tests
- [ ] Container hardening tests
- [ ] DNS validation tests
- [ ] Execution tests

### Verification
- [ ] bash tool runs in container with no network
- [ ] Private IPs blocked
- [ ] `pnpm check` passes
```

---

## Next Milestone

After completing M4, proceed to [M5: Tool System](./M5-tools.md).

---

*Last updated: 2026-01-29*
