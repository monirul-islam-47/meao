# Sandbox Specification

**Status:** ACTIVE
**Version:** 1.0
**Last Updated:** 2026-01-29

This document specifies how meao isolates untrusted code execution, with particular focus on network isolation for the bash tool.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SANDBOX ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SANDBOX LEVELS:                                                    │
│                                                                      │
│  none      - No isolation (owner-trusted tools only)               │
│  process   - Separate process, limited env, path restrictions      │
│  container - Docker with network isolation, resource limits        │
│                                                                      │
│  DEFAULT BY TOOL:                                                   │
│                                                                      │
│  • read, write, edit  → process                                    │
│  • web_fetch          → process (network via proxy)                │
│  • bash               → container (default: no network)            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Container Sandbox (bash tool)

The bash tool runs in a Docker container with strict isolation:

### Network Isolation

```
┌─────────────────────────────────────────────────────────────────────┐
│                    NETWORK ISOLATION MODES                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  MODE 1: NO NETWORK (Default)                                       │
│  ────────────────────────────                                        │
│  • Container runs with --network=none                               │
│  • Cannot make any network connections                              │
│  • Safest option for file operations, build tasks                  │
│                                                                      │
│  MODE 2: PROXY EGRESS (When network needed)                        │
│  ──────────────────────────────────────────                          │
│  • Container connects via meao-proxy                               │
│  • Proxy enforces allowlist of hosts/ports                         │
│  • All requests logged                                              │
│  • Blocks private IPs, metadata endpoints at network layer         │
│                                                                      │
│  MODE 3: HOST NETWORK (Dangerous - requires explicit approval)     │
│  ───────────────────────────────────────────────────────            │
│  • Full network access                                              │
│  • Only for trusted operations with user approval                  │
│  • Logged and audited                                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Docker Configuration

```yaml
# meao-sandbox container template
version: '3.8'
services:
  sandbox:
    image: meao-sandbox:latest

    # SECURITY: No network by default
    network_mode: none

    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          memory: 64M

    # Capabilities dropped
    cap_drop:
      - ALL

    # Read-only root filesystem
    read_only: true

    # No privilege escalation
    security_opt:
      - no-new-privileges:true
      # Use default Docker seccomp profile (blocks dangerous syscalls)
      - seccomp:unconfined  # Override to: seccomp:/path/to/meao-seccomp.json

    # Process limits (prevent fork bombs)
    pids_limit: 100

    # File descriptor limits
    ulimits:
      nofile:
        soft: 1024
        hard: 4096
      nproc:
        soft: 100
        hard: 200

    # Workspace mounted read-write
    volumes:
      - type: bind
        source: ${WORKSPACE}
        target: /workspace
        read_only: false

    # Temp directories for tools
    tmpfs:
      - /tmp:size=100M,mode=1777
      - /var/tmp:size=50M,mode=1777

    # Non-root user
    user: "1000:1000"

    # Working directory
    working_dir: /workspace

    # Hostname isolation
    hostname: sandbox

    # No host IPC/PID namespace
    ipc: private
    pid: container
```

### Future Hardening (Planned)

```yaml
# Additional hardening for high-security deployments:

# Custom seccomp profile (blocks even more syscalls)
security_opt:
  - seccomp:/etc/meao/seccomp-strict.json

# AppArmor profile (Linux only)
security_opt:
  - apparmor:meao-sandbox

# SELinux label (RHEL/CentOS)
security_opt:
  - label:type:meao_sandbox_t

# Rootless Docker (no root daemon)
# Requires Docker rootless mode setup
```

### Network Proxy for Egress

When network is needed, route through a proxy:

```typescript
interface ProxyConfig {
  // Listen address (inside proxy container)
  listenAddr: string

  // Allowed destinations
  allowlist: {
    hosts: string[]              // Glob patterns: '*.github.com'
    ports: number[]              // Allowed ports
  }

  // Always blocked (overrides allowlist)
  blocklist: {
    hosts: string[]              // Blocked hosts
    ipRanges: string[]           // CIDR ranges
  }

  // Logging
  logRequests: boolean
  logResponses: boolean
}

const defaultProxyConfig: ProxyConfig = {
  listenAddr: '0.0.0.0:3128',

  allowlist: {
    hosts: [
      // Package registries
      '*.npmjs.org',
      '*.npmjs.com',
      'registry.yarnpkg.com',
      '*.pypi.org',
      'pypi.python.org',
      '*.crates.io',
      '*.rubygems.org',

      // Version control
      '*.github.com',
      '*.gitlab.com',
      '*.bitbucket.org',

      // Common CDNs
      '*.cloudflare.com',
      '*.jsdelivr.net',
      '*.unpkg.com',

      // User-configured additions
      // ...
    ],
    ports: [80, 443],
  },

  blocklist: {
    hosts: [
      'localhost',
      '*.local',
      '*.internal',
    ],
    ipRanges: [
      // Private networks
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',

      // Loopback
      '127.0.0.0/8',

      // Link-local
      '169.254.0.0/16',

      // Cloud metadata
      '169.254.169.254/32',      // AWS, GCP, Azure
      '100.100.100.200/32',      // Alibaba
      'fd00:ec2::254/128',       // AWS IPv6
    ],
  },

  logRequests: true,
  logResponses: false,
}
```

### Proxy Implementation

```typescript
// HTTP/HTTPS proxy with allowlist enforcement and DNS rebinding protection
class SandboxProxy {
  private config: ProxyConfig

  async handleRequest(req: IncomingMessage): Promise<void> {
    const target = this.parseTarget(req)

    // 1. Check hostname allowlist (fast reject)
    if (!this.isHostAllowed(target.host)) {
      this.denyRequest(req, 'Destination not in allowlist')
      await this.audit('proxy_denied', target)
      return
    }

    // 2. CRITICAL: Resolve hostname and validate FINAL IP
    //    This prevents DNS rebinding attacks
    const resolvedIP = await this.resolveAndValidate(target.host)
    if (!resolvedIP) {
      this.denyRequest(req, 'DNS resolution blocked')
      await this.audit('proxy_blocked_dns', target)
      return
    }

    // 3. Check port
    if (!this.config.allowlist.ports.includes(target.port)) {
      this.denyRequest(req, 'Port not allowed')
      await this.audit('proxy_denied_port', target)
      return
    }

    // 4. Forward request using resolved IP (not hostname)
    await this.audit('proxy_allowed', { ...target, resolvedIP })
    await this.forwardWithRedirectValidation(req, target, resolvedIP)
  }

  // MUST resolve and validate IP before connecting
  private async resolveAndValidate(hostname: string): Promise<string | null> {
    try {
      const addresses = await dns.resolve4(hostname)

      for (const ip of addresses) {
        // Check EVERY resolved IP against blocklist
        if (this.isIPBlocked(ip)) {
          await this.audit('dns_rebind_blocked', { hostname, ip })
          return null
        }
      }

      return addresses[0]
    } catch {
      return null
    }
  }

  private isIPBlocked(ip: string): boolean {
    for (const range of this.config.blocklist.ipRanges) {
      if (ipInRange(ip, range)) {
        return true
      }
    }
    return false
  }

  // MUST re-validate on redirects
  private async forwardWithRedirectValidation(
    req: IncomingMessage,
    target: Target,
    resolvedIP: string
  ): Promise<void> {
    const response = await this.makeRequest(target, resolvedIP)

    // Handle redirects securely
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location
      if (location) {
        const redirectTarget = new URL(location, `https://${target.host}`)

        // CRITICAL: Re-validate redirect destination
        const redirectIP = await this.resolveAndValidate(redirectTarget.hostname)
        if (!redirectIP) {
          this.denyRequest(req, 'Redirect to blocked destination')
          await this.audit('redirect_blocked', { from: target, to: redirectTarget.href })
          return
        }

        // Also check if redirect host is in allowlist
        if (!this.isHostAllowed(redirectTarget.hostname)) {
          this.denyRequest(req, 'Redirect to non-allowed host')
          await this.audit('redirect_denied', { from: target, to: redirectTarget.href })
          return
        }

        // Continue with validated redirect
        await this.forwardWithRedirectValidation(req, {
          host: redirectTarget.hostname,
          port: parseInt(redirectTarget.port) || 443,
        }, redirectIP)
        return
      }
    }

    // Normal response
    this.pipeResponse(response, req)
  }

  private isHostAllowed(host: string): boolean {
    // Check blocked hosts first
    for (const pattern of this.config.blocklist.hosts) {
      if (matchGlob(host, pattern)) {
        return false
      }
    }

    // Check allowlist
    for (const pattern of this.config.allowlist.hosts) {
      if (matchGlob(host, pattern)) {
        return true
      }
    }

    return false
  }
}
```

**DNS Rebinding Protection Summary:**
1. Resolve hostname to IP BEFORE connecting
2. Validate ALL resolved IPs against private/metadata ranges
3. Connect using validated IP, not hostname
4. Re-validate on every redirect
5. Log all blocked DNS resolutions for audit

### Docker Network Setup

```bash
#!/bin/bash
# Setup sandbox network infrastructure

# Create isolated network for sandbox containers
docker network create \
  --driver bridge \
  --internal \
  meao-sandbox-net

# Create proxy network (has external access)
docker network create \
  --driver bridge \
  meao-proxy-net

# Run proxy container
docker run -d \
  --name meao-proxy \
  --network meao-proxy-net \
  --network meao-sandbox-net \
  -e PROXY_CONFIG=/etc/meao/proxy.json \
  -v ~/.meao/proxy.json:/etc/meao/proxy.json:ro \
  meao-proxy:latest

# Sandbox containers connect to meao-sandbox-net
# They can reach proxy at meao-proxy:3128
# But cannot reach internet directly
```

### Network Mode Selection

```typescript
type NetworkMode = 'none' | 'proxy' | 'host'

function selectNetworkMode(command: string, context: ToolContext): NetworkMode {
  // Analyze command to determine if network is needed
  const needsNetwork = detectNetworkUsage(command)

  if (!needsNetwork) {
    return 'none'
  }

  // Check if user has pre-approved network for this session
  if (context.approvals.has('bash:network')) {
    return 'proxy'
  }

  // Network needed but not approved - will need to ask
  return 'proxy'  // Will trigger approval prompt
}

function detectNetworkUsage(command: string): boolean {
  const networkPatterns = [
    /\bcurl\b/,
    /\bwget\b/,
    /\bfetch\b/,
    /\bnpm\s+(install|i|ci|update|publish)/,
    /\byarn\s+(add|install|upgrade)/,
    /\bpip\s+(install|download)/,
    /\bgit\s+(clone|fetch|pull|push)/,
    /\bssh\b/,
    /\bscp\b/,
    /\brsync\b/,
    /\bnc\b/,
    /\btelnet\b/,
    /\bhttp[s]?:\/\//,
  ]

  return networkPatterns.some(p => p.test(command))
}
```

---

## Process Sandbox

For tools that don't need full container isolation:

```typescript
interface ProcessSandboxConfig {
  // Environment
  env: 'inherit' | 'clean' | 'explicit'
  allowedEnvVars?: string[]

  // Filesystem
  cwd: string
  allowedPaths: string[]
  blockedPaths: string[]

  // Resources
  timeout: number
  maxOutputSize: number

  // Process
  uid?: number
  gid?: number
}

async function executeInProcessSandbox(
  command: string,
  config: ProcessSandboxConfig
): Promise<ExecutionResult> {
  // Build environment
  let env: Record<string, string> = {}
  if (config.env === 'inherit') {
    env = { ...process.env }
  } else if (config.env === 'explicit') {
    for (const key of config.allowedEnvVars ?? []) {
      if (process.env[key]) {
        env[key] = process.env[key]
      }
    }
  }
  // 'clean' = empty env

  // Validate working directory
  const cwd = path.resolve(config.cwd)
  if (!isPathAllowed(cwd, config.allowedPaths, config.blockedPaths)) {
    throw new SecurityError('Working directory not allowed')
  }

  // Execute with timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeout)

  try {
    const result = await execFile(command, [], {
      cwd,
      env,
      signal: controller.signal,
      maxBuffer: config.maxOutputSize,
      uid: config.uid,
      gid: config.gid,
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    if (error.killed) {
      return { stdout: '', stderr: 'Timeout exceeded', exitCode: 124 }
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
```

---

## Sandbox Selection

```typescript
function selectSandbox(tool: ToolPlugin, context: ToolContext): SandboxLevel {
  const configured = tool.capability.execution.sandbox

  // Owner can downgrade sandbox (at their own risk)
  if (context.user.isOwner && context.approvals.has(`${tool.name}:no-sandbox`)) {
    return 'none'
  }

  // Container required for bash
  if (tool.name === 'bash') {
    return 'container'
  }

  // Use configured level
  return configured
}
```

---

## Resource Limits

### Container Limits

| Resource | Default | Max |
|----------|---------|-----|
| CPU | 1 core | 2 cores |
| Memory | 512 MB | 2 GB |
| Disk | Workspace only | N/A |
| Time | 2 minutes | 10 minutes |
| Processes | 100 | 500 |
| Open files | 1024 | 4096 |

### Process Limits

| Resource | Default | Max |
|----------|---------|-----|
| Time | 60 seconds | 5 minutes |
| Output | 1 MB | 10 MB |
| Memory | Inherited | N/A |

---

## Sandbox Images

### Base Image

```dockerfile
# meao-sandbox base image
FROM debian:bookworm-slim

# Install common development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core
    bash \
    coreutils \
    findutils \
    grep \
    sed \
    awk \
    # Development
    git \
    make \
    gcc \
    g++ \
    # Languages (slim versions)
    nodejs \
    npm \
    python3 \
    python3-pip \
    # Utilities
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash -u 1000 sandbox

# Set up workspace
RUN mkdir /workspace && chown sandbox:sandbox /workspace

USER sandbox
WORKDIR /workspace

# No entrypoint - commands passed directly
```

### Specialized Images

```dockerfile
# meao-sandbox-node - Node.js focused
FROM meao-sandbox:latest
RUN npm install -g typescript ts-node eslint prettier

# meao-sandbox-python - Python focused
FROM meao-sandbox:latest
RUN pip3 install --user poetry pytest black mypy

# meao-sandbox-rust - Rust focused
FROM meao-sandbox:latest
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

---

## Execution Flow

```typescript
async function executeInSandbox(
  tool: ToolPlugin,
  args: unknown,
  context: ToolContext
): Promise<ToolResult> {
  const sandboxLevel = selectSandbox(tool, context)

  if (sandboxLevel === 'none') {
    return executeDirectly(tool, args)
  }

  if (sandboxLevel === 'process') {
    return executeInProcessSandbox(tool, args, {
      env: tool.capability.execution.env,
      allowedEnvVars: tool.capability.execution.allowedEnvVars,
      cwd: context.workspace,
      allowedPaths: tool.capability.execution.allowedPaths ?? [context.workspace],
      blockedPaths: tool.capability.execution.blockedPaths ?? [],
      timeout: tool.capability.execution.timeout,
      maxOutputSize: tool.capability.execution.maxOutputSize,
    })
  }

  if (sandboxLevel === 'container') {
    const networkMode = selectNetworkMode(args.command, context)

    // If network needed, check approval
    if (networkMode !== 'none' && !context.approvals.has('bash:network')) {
      const approved = await requestApproval(
        `Command requires network access. Allow via proxy?`,
        { command: args.command, mode: 'proxy' }
      )
      if (!approved) {
        throw new UserCancelledError('Network access denied')
      }
    }

    return executeInContainer(tool, args, {
      image: 'meao-sandbox:latest',
      networkMode,
      workspace: context.workspace,
      timeout: tool.capability.execution.timeout,
      resources: {
        cpus: 1,
        memory: '512m',
      },
    })
  }
}
```

---

## Audit Logging

All sandbox operations are logged:

```typescript
interface SandboxAuditEntry {
  timestamp: Date
  action: 'sandbox_execute' | 'sandbox_timeout' | 'proxy_request' | 'proxy_blocked'

  tool: string
  sandboxLevel: 'none' | 'process' | 'container'
  networkMode?: 'none' | 'proxy' | 'host'

  // Command (redacted)
  commandHash: string              // SHA256 for correlation
  commandPreview: string           // First 100 chars

  // Outcome
  exitCode?: number
  durationMs: number

  // Network (if applicable)
  networkTarget?: {
    host: string
    port: number
    allowed: boolean
  }
}
```

---

## Security Guarantees

**CRITICAL: What provides security vs. what is advisory**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SECURITY ENFORCEMENT MODEL                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ENFORCEMENT (provides security):                                   │
│  ────────────────────────────────                                    │
│  • Docker --network=none        → No network access possible        │
│  • Proxy IP validation          → Private IPs blocked at connect    │
│  • Container cap_drop: ALL      → No privilege escalation          │
│  • Container user: 1000         → Non-root execution               │
│  • Workspace bind mount         → Filesystem isolation             │
│                                                                      │
│  ADVISORY (UX hints only, NOT security controls):                   │
│  ────────────────────────────────────────────────                    │
│  • detectNetworkUsage(command)  → Regex scanning for network cmds  │
│  • Command pattern detection    → Heuristic, can be bypassed       │
│                                                                      │
│  The regex-based command scanning is ONLY for user experience:     │
│  • It helps predict when to prompt for network approval            │
│  • It is NOT relied upon for security enforcement                  │
│  • Enforcement comes from the container having no network          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Security Invariants

```
INV-S1: bash tool MUST run in container by default

INV-S2: Container network MUST be 'none' by default

INV-S3: Proxy MUST block all private IP ranges at network layer

INV-S4: Proxy MUST block cloud metadata endpoints

INV-S5: Container MUST drop all capabilities

INV-S6: Container MUST run as non-root user

INV-S7: Network upgrade from 'none' to 'proxy' MUST require approval

INV-S8: Proxy MUST validate final resolved IP, not just hostname
        (prevents DNS rebinding attacks)

INV-S9: Proxy MUST re-validate IP on redirects
        (prevents redirect to internal IP)
```

---

## User Configuration

```json
{
  "sandbox": {
    "bash": {
      "defaultNetwork": "none",
      "proxyAllowlist": [
        "*.company.com",
        "internal-registry.local"
      ],
      "resources": {
        "memory": "1g",
        "timeout": 300000
      }
    },
    "images": {
      "default": "meao-sandbox:latest",
      "node": "meao-sandbox-node:latest",
      "python": "meao-sandbox-python:latest"
    }
  }
}
```

---

*This specification is living documentation. Update as isolation requirements evolve.*

*Last updated: 2026-01-29*
