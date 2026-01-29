# Tool Capability Specification

**Status:** ACTIVE
**Version:** 1.0
**Last Updated:** 2026-01-29

This document defines the capability model for tools, extending beyond simple approval policies to include data sensitivity, network controls, and execution constraints.

**Related Documents:**
- [LABELS.md](./LABELS.md) - Unified trust/sensitivity labeling system
- [SECRET_DETECTION.md](./SECRET_DETECTION.md) - Shared secret detection module
- [SANDBOX.md](./SANDBOX.md) - Container and process isolation
- [SECURITY.md](./SECURITY.md) - Threat model and invariants

---

## Overview

Tools are not just "auto/ask/always" - they have rich security properties that must be specified and enforced.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TOOL CAPABILITY MODEL                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  OLD MODEL (Simple):                                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  policy: {                                                   │   │
│  │    approval: 'auto' | 'ask' | 'always'                      │   │
│  │  }                                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  NEW MODEL (Full Capability):                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  capability: {                                               │   │
│  │    approval: ApprovalPolicy                                  │   │
│  │    data: DataPolicy                                          │   │
│  │    network: NetworkPolicy                                    │   │
│  │    execution: ExecutionPolicy                                │   │
│  │    audit: AuditPolicy                                        │   │
│  │  }                                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Capability Schema

```typescript
interface ToolCapability {
  // APPROVAL: When to ask user
  approval: {
    level: 'auto' | 'ask' | 'always'
    dangerPatterns?: RegExp[]           // Patterns that escalate to 'always'
    trustAfterApproval?: boolean        // Remember approval for session
  }

  // DATA: What data this tool handles
  data: {
    sensitivity: 'none' | 'low' | 'medium' | 'high' | 'secret'
    canReadSecrets: boolean             // Can access ~/.ssh, env vars, etc.
    canLeakData: boolean                // Output goes somewhere external
    sanitizeOutput: boolean             // Redact secrets from output
  }

  // NETWORK: What network access is allowed
  network: {
    access: 'none' | 'limited' | 'full'
    allowedHosts?: string[]             // Whitelist of allowed hosts
    blockedHosts?: string[]             // Blacklist (applied after whitelist)
    blockedPorts?: number[]             // Block specific ports
    blockPrivateIPs: boolean            // Block 10.x, 192.168.x, etc.
    blockMetadata: boolean              // Block cloud metadata endpoints
  }

  // EXECUTION: How this tool runs
  execution: {
    sandbox: 'none' | 'process' | 'container'
    timeout: number                     // Max execution time (ms)
    maxOutputSize: number               // Max output bytes
    allowedPaths?: string[]             // Filesystem whitelist
    blockedPaths?: string[]             // Filesystem blacklist
    env: 'inherit' | 'clean' | 'explicit'
    allowedEnvVars?: string[]           // If 'explicit', which vars
  }

  // AUDIT: What to log
  audit: {
    logArgs: boolean                    // Log tool arguments
    redactPatterns?: RegExp[]           // Patterns to redact from logs
    logOutput: boolean                  // Log tool output
    alertOn?: string[]                  // Patterns that trigger alerts
  }
}
```

---

## Default Tool Capabilities

### read - File Reading

```typescript
const readCapability: ToolCapability = {
  approval: {
    level: 'auto',
    dangerPatterns: [
      /\/etc\/passwd/,
      /\/etc\/shadow/,
      /\.ssh\//,
      /\.gnupg\//,
      /\.aws\//,
      /\.env$/,
      /credentials/i,
      /secret/i,
    ],
    trustAfterApproval: true,
  },

  data: {
    sensitivity: 'high',                // Can read sensitive files
    canReadSecrets: true,               // YES - this is the concern
    canLeakData: false,                 // Output stays local
    sanitizeOutput: true,               // Redact secrets before showing AI
  },

  network: {
    access: 'none',
    blockPrivateIPs: true,
    blockMetadata: true,
  },

  execution: {
    sandbox: 'process',
    timeout: 10000,
    maxOutputSize: 1_000_000,           // 1MB max
    allowedPaths: ['$WORKSPACE'],       // Default: workspace only
    blockedPaths: [
      '/etc/shadow',
      '$HOME/.ssh/id_*',                // Private keys
      '$HOME/.gnupg/private-keys*',
      '$HOME/.aws/credentials',
    ],
    env: 'clean',
  },

  audit: {
    logArgs: true,                      // Log which files read
    // Use SecretDetector from SECRET_DETECTION.md
    useSharedSecretDetector: true,
    logOutput: false,                   // Don't log file contents
  },

  // Integration with LABELS.md
  labels: {
    outputTrust: 'user',                // User's files (workspace)
    outputDataClass: 'sensitive',       // May contain secrets (detected)
    acceptsUntrusted: false,            // Path comes from trusted source
  },
}
```

### web_fetch - URL Fetching

```typescript
const webFetchCapability: ToolCapability = {
  approval: {
    level: 'auto',                      // GET to known hosts
    askForMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],  // Non-GET requires approval
    dangerPatterns: [
      /localhost/,
      /127\.0\.0\.1/,
      /169\.254\./,                      // Metadata
      /10\.\d+\.\d+\.\d+/,               // Private
      /192\.168\./,
      /172\.(1[6-9]|2[0-9]|3[01])\./,
    ],
    trustAfterApproval: false,          // Check each URL
  },

  data: {
    sensitivity: 'medium',
    canReadSecrets: false,
    canLeakData: true,                  // YES - sends request externally
    sanitizeOutput: true,
  },

  network: {
    access: 'limited',
    // TIGHTENED: Default to trusted domains only
    // Unknown domains require approval
    allowedHosts: [
      // Documentation
      '*.github.com',
      '*.githubusercontent.com',
      '*.gitlab.com',
      '*.stackoverflow.com',
      '*.stackexchange.com',
      '*.mozilla.org',
      '*.mdn.io',

      // Package registries
      '*.npmjs.com',
      '*.npmjs.org',
      '*.pypi.org',
      '*.crates.io',

      // Common docs
      'docs.*',
      '*.readthedocs.io',
      '*.rtfd.io',

      // News/reference
      '*.wikipedia.org',
      '*.arxiv.org',
    ],
    // If URL not in allowedHosts, approval is required
    requireApprovalForUnknownHosts: true,
    blockedHosts: [],
    blockedPorts: [22, 23, 25, 445, 3306, 5432, 6379, 27017],  // SSH, SMTP, DB
    blockPrivateIPs: true,
    blockMetadata: true,                // Block 169.254.x.x
  },

  execution: {
    sandbox: 'process',
    timeout: 30000,
    maxOutputSize: 10_000_000,          // 10MB max
    env: 'clean',
  },

  audit: {
    logArgs: true,                      // Log URLs fetched
    logOutput: false,                   // Don't log page content
  },

  // Integration with LABELS.md
  labels: {
    outputTrust: 'untrusted',           // All web content is untrusted
    outputDataClass: 'internal',        // May contain sensitive info
    acceptsUntrusted: true,             // Can process any input
  },
}
```

### write - File Writing

```typescript
const writeCapability: ToolCapability = {
  approval: {
    level: 'ask',
    dangerPatterns: [
      /\.bashrc$/,
      /\.zshrc$/,
      /\.profile$/,
      /crontab/,
      /\.ssh\//,
      /authorized_keys/,
    ],
    trustAfterApproval: true,
  },

  data: {
    sensitivity: 'high',
    canReadSecrets: false,
    canLeakData: false,
    sanitizeOutput: false,
  },

  network: {
    access: 'none',
    blockPrivateIPs: true,
    blockMetadata: true,
  },

  execution: {
    sandbox: 'process',
    timeout: 10000,
    maxOutputSize: 10_000_000,
    allowedPaths: ['$WORKSPACE'],
    blockedPaths: [
      '/etc/',
      '/usr/',
      '/bin/',
      '/sbin/',
      '$HOME/.ssh/',
      '$HOME/.gnupg/',
    ],
    env: 'clean',
  },

  audit: {
    logArgs: true,                      // Log file paths
    logOutput: false,
  },
}
```

### bash - Command Execution

See [SANDBOX.md](./SANDBOX.md) for container isolation details.

```typescript
const bashCapability: ToolCapability = {
  approval: {
    level: 'ask',
    dangerPatterns: [
      /rm\s+(-rf?|--recursive)/,
      /sudo/,
      /chmod\s+777/,
      /mkfs/,
      /dd\s+if=/,
      />\s*\/dev\//,
      /curl.*\|\s*(bash|sh)/,
      /wget.*\|\s*(bash|sh)/,
      /eval\s/,
      /base64.*-d/,
    ],
    trustAfterApproval: false,          // Check each command
  },

  data: {
    sensitivity: 'high',
    canReadSecrets: true,
    canLeakData: true,                  // Can curl/wget to external
    sanitizeOutput: true,
  },

  network: {
    // IMPORTANT: See SANDBOX.md for network isolation
    // Container runs with network=none by default
    // Network commands routed through proxy with allowlist
    access: 'none',                     // Default: no network
    accessUpgradeable: 'proxy',         // Can upgrade to proxy with approval
    // Proxy handles all blocking - see SANDBOX.md
    blockPrivateIPs: true,              // Enforced at proxy layer
    blockMetadata: true,                // Enforced at proxy layer
  },

  execution: {
    sandbox: 'container',               // Always in Docker
    // See SANDBOX.md for container configuration
    networkMode: 'none',                // Default: --network=none
    timeout: 120000,                    // 2 minute max
    maxOutputSize: 1_000_000,
    allowedPaths: ['$WORKSPACE'],
    env: 'explicit',
    allowedEnvVars: [
      'PATH',
      'HOME',
      'USER',
      'SHELL',
      'TERM',
      'LANG',
      'LC_ALL',
    ],
  },

  audit: {
    logArgs: true,
    // Use SecretDetector from SECRET_DETECTION.md
    useSharedSecretDetector: true,
    logOutput: true,                    // Log output for audit
    alertOn: ['rm -rf /', 'sudo rm'],
  },

  // Integration with LABELS.md
  labels: {
    outputTrust: 'user',                // Output from user's commands
    outputDataClass: 'sensitive',       // May contain anything
    acceptsUntrusted: true,             // Can process any input (but watch egress)
  },
}
```

### send_message - External Communication

```typescript
const sendMessageCapability: ToolCapability = {
  approval: {
    level: 'always',                    // Always ask before sending
    trustAfterApproval: false,
  },

  data: {
    sensitivity: 'high',
    canReadSecrets: false,
    canLeakData: true,                  // Explicitly sends data out
    sanitizeOutput: true,               // Don't let AI send secrets
  },

  network: {
    access: 'limited',
    allowedHosts: [
      'api.telegram.org',
      'discord.com',
      'gateway.discord.gg',
    ],
    blockPrivateIPs: true,
    blockMetadata: true,
  },

  execution: {
    sandbox: 'process',
    timeout: 30000,
    maxOutputSize: 100_000,
    env: 'explicit',
    allowedEnvVars: [],
  },

  audit: {
    logArgs: true,                      // Log recipient (redacted content)
    redactPatterns: [/.*/],             // Redact message content
    logOutput: true,
  },
}
```

---

## Egress Control

### Why Egress Matters

Even "read-only" tools can leak data if the AI can later use another tool to send it externally.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       EGRESS THREAT MODEL                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ATTACK CHAIN:                                                      │
│  1. AI reads ~/.ssh/id_rsa via 'read' tool                         │
│  2. AI uses 'web_fetch' to POST to attacker.com                    │
│  3. Private key exfiltrated                                         │
│                                                                      │
│  MITIGATIONS:                                                       │
│  1. 'read' sanitizes output, redacting key patterns                │
│  2. 'web_fetch' blocks POST to unknown hosts (or asks)            │
│  3. 'bash' in sandbox with no network by default                   │
│  4. Audit log captures both operations for review                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Egress Whitelist Mode

For high-security environments:

```typescript
const strictEgressPolicy: NetworkPolicy = {
  access: 'limited',
  allowedHosts: [
    // AI providers
    'api.anthropic.com',
    'api.openai.com',

    // Channels
    'api.telegram.org',
    'discord.com',
    'gateway.discord.gg',

    // Trusted services (user-configured)
    'github.com',
    'api.github.com',
    'registry.npmjs.org',
  ],
  blockedHosts: ['*'],                  // Block everything else
  blockPrivateIPs: true,
  blockMetadata: true,
}
```

---

## Secret Detection

Tools that `canReadSecrets` must sanitize output:

```typescript
const secretPatterns = [
  // Generic high entropy
  /[A-Za-z0-9+/]{40,}/,                  // Base64 blobs

  // API Keys
  /sk-[A-Za-z0-9]{48}/,                  // OpenAI
  /sk-ant-[A-Za-z0-9-]{95}/,             // Anthropic
  /AKIA[A-Z0-9]{16}/,                    // AWS Access Key
  /ghp_[A-Za-z0-9]{36}/,                 // GitHub PAT
  /gho_[A-Za-z0-9]{36}/,                 // GitHub OAuth
  /glpat-[A-Za-z0-9-]{20}/,              // GitLab PAT

  // Private Keys
  /-----BEGIN [A-Z]+ PRIVATE KEY-----/,
  /-----BEGIN OPENSSH PRIVATE KEY-----/,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/,

  // Tokens
  /Bearer [A-Za-z0-9._-]+/,
  /Basic [A-Za-z0-9+/=]+/,

  // Database URLs
  /postgres:\/\/[^@]+:[^@]+@/,
  /mongodb(\+srv)?:\/\/[^@]+:[^@]+@/,
  /redis:\/\/:[^@]+@/,

  // Generic patterns
  /password\s*[=:]\s*['"]?[^'"]+['"]?/i,
  /api[_-]?key\s*[=:]\s*['"]?[^'"]+['"]?/i,
  /secret\s*[=:]\s*['"]?[^'"]+['"]?/i,
  /token\s*[=:]\s*['"]?[^'"]+['"]?/i,
]
```

### Sanitization Strategy

```typescript
function sanitizeToolOutput(output: string, patterns: RegExp[]): string {
  let result = output

  for (const pattern of patterns) {
    result = result.replace(pattern, '[REDACTED]')
  }

  return result
}

// Before passing tool output to AI:
const aiInput = sanitizeToolOutput(toolOutput, secretPatterns)
```

---

## Capability Enforcement

### Runtime Checks

```typescript
async function executeTool(
  tool: ToolPlugin,
  args: unknown,
  context: ToolContext
): Promise<ToolResult> {
  const cap = tool.capability

  // 1. Check approval
  if (requiresApproval(cap, args)) {
    const approved = await requestApproval(tool, args, context)
    if (!approved) return { error: 'User denied' }
  }

  // 2. Validate paths
  if (cap.execution.allowedPaths) {
    validatePaths(args, cap.execution.allowedPaths, cap.execution.blockedPaths)
  }

  // 3. Validate network (for web_fetch, etc.)
  if (cap.network.access !== 'none') {
    validateNetwork(args, cap.network)
  }

  // 4. Execute in appropriate sandbox
  const result = await executeInSandbox(tool, args, cap.execution)

  // 5. Sanitize output
  if (cap.data.sanitizeOutput) {
    result.output = sanitizeToolOutput(result.output, secretPatterns)
  }

  // 6. Audit
  await auditToolExecution(tool, args, result, cap.audit)

  return result
}
```

### Path Validation

```typescript
function validatePaths(args: unknown, allowed: string[], blocked: string[]): void {
  const paths = extractPaths(args)

  for (const path of paths) {
    const canonical = resolvePath(path)  // Resolve symlinks, ../, etc.

    // Check blocked first
    for (const pattern of blocked) {
      if (matchPath(canonical, expandPattern(pattern))) {
        throw new SecurityError(`Blocked path: ${path}`)
      }
    }

    // Check allowed
    let isAllowed = false
    for (const pattern of allowed) {
      if (matchPath(canonical, expandPattern(pattern))) {
        isAllowed = true
        break
      }
    }

    if (!isAllowed) {
      throw new SecurityError(`Path not allowed: ${path}`)
    }
  }
}
```

### Network Validation

```typescript
function validateNetwork(args: unknown, policy: NetworkPolicy): void {
  const urls = extractUrls(args)

  for (const url of urls) {
    const parsed = new URL(url)

    // Block private IPs
    if (policy.blockPrivateIPs && isPrivateIP(parsed.hostname)) {
      throw new SecurityError(`Private IP blocked: ${url}`)
    }

    // Block metadata
    if (policy.blockMetadata && isMetadataIP(parsed.hostname)) {
      throw new SecurityError(`Metadata endpoint blocked: ${url}`)
    }

    // Block ports
    if (policy.blockedPorts?.includes(parseInt(parsed.port || '80'))) {
      throw new SecurityError(`Port blocked: ${url}`)
    }

    // Check host allowlist
    if (policy.allowedHosts && !matchHost(parsed.hostname, policy.allowedHosts)) {
      throw new SecurityError(`Host not allowed: ${url}`)
    }

    // Check host blocklist
    if (policy.blockedHosts && matchHost(parsed.hostname, policy.blockedHosts)) {
      throw new SecurityError(`Host blocked: ${url}`)
    }
  }
}
```

---

## User Configuration

Users can override default capabilities in config:

```json
{
  "tools": {
    "read": {
      "capability": {
        "approval": {
          "level": "auto"
        },
        "execution": {
          "allowedPaths": [
            "$WORKSPACE",
            "$HOME/Documents/projects"
          ]
        }
      }
    },
    "web_fetch": {
      "capability": {
        "network": {
          "allowedHosts": [
            "*.github.com",
            "*.stackoverflow.com",
            "docs.*"
          ]
        }
      }
    },
    "bash": {
      "capability": {
        "execution": {
          "sandbox": "none"
        }
      }
    }
  }
}
```

**Warning:** Relaxing security requires explicit user action. The UI should make clear what is being changed.

---

## Migration from Simple Policy

Existing tools using the old `policy` field automatically get default capabilities:

```typescript
function migratePolicy(oldPolicy: { approval: string }): ToolCapability {
  return {
    approval: {
      level: oldPolicy.approval as 'auto' | 'ask' | 'always',
      trustAfterApproval: true,
    },
    data: {
      sensitivity: 'medium',
      canReadSecrets: false,
      canLeakData: false,
      sanitizeOutput: true,
    },
    network: {
      access: 'none',
      blockPrivateIPs: true,
      blockMetadata: true,
    },
    execution: {
      sandbox: 'process',
      timeout: 60000,
      maxOutputSize: 1_000_000,
      env: 'clean',
    },
    audit: {
      logArgs: true,
      logOutput: false,
    },
  }
}
```

---

*This specification is living documentation. Update as tools evolve.*

*Last updated: 2026-01-29*
