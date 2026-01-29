# Configuration Specification

**Status:** ACTIVE
**Version:** 1.0
**Last Updated:** 2026-01-29

This document specifies the configuration system for meao - file locations, schema, environment overrides, validation, and hot-reload behavior.

**Related Documents:**
- [INTERFACES.md](./INTERFACES.md) - AppConfigSchema definition
- [KEY_MANAGEMENT.md](./KEY_MANAGEMENT.md) - Credential storage
- [SECURITY.md](./SECURITY.md) - Secure defaults

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONFIGURATION SYSTEM                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  LAYERS (highest priority wins):                                    │
│  ─────────────────────────────────                                   │
│  1. CLI arguments       --port 3001                                 │
│  2. Environment vars    MEAO_PORT=3001                              │
│  3. User config         ~/.meao/config.json                         │
│  4. Defaults            Built into application                      │
│                                                                      │
│  FEATURES:                                                          │
│  • Zod validation with helpful error messages                       │
│  • Hot-reload for non-sensitive settings                           │
│  • Secrets stored separately (encrypted)                           │
│  • Environment-specific overrides                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File Locations

### Standard Paths

```
~/.meao/                              # MEAO_HOME (can be overridden)
├── config.json                       # Main configuration
├── config.local.json                 # Local overrides (gitignored)
├── credentials.enc                   # Encrypted credentials
├── keys/                             # Encryption keys
│   ├── kek.salt
│   └── *.dek.enc
└── ...
```

### Path Resolution

```typescript
function getMeaoHome(): string {
  // 1. Explicit environment variable
  if (process.env.MEAO_HOME) {
    return process.env.MEAO_HOME
  }

  // 2. XDG_CONFIG_HOME (Linux)
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'meao')
  }

  // 3. Platform defaults
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || '', 'meao')
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'meao')
    default:
      return path.join(os.homedir(), '.meao')
  }
}

function getConfigPath(): string {
  return path.join(getMeaoHome(), 'config.json')
}
```

---

## Configuration Schema

### Complete Schema

See [INTERFACES.md](./INTERFACES.md) for full `AppConfigSchema`. Key sections:

```typescript
const AppConfigSchema = z.object({
  // Schema version for migrations
  version: z.number().int().positive(),

  // Owner identity
  owner: OwnerConfigSchema,

  // Security
  keyManagement: KeyManagementConfigSchema,

  // Server
  server: ServerConfigSchema,

  // Channels
  channels: z.record(ChannelConfigSchema),

  // Skills
  skills: z.record(SkillConfigSchema),

  // Tools
  tools: z.record(ToolConfigSchema),

  // AI Providers
  providers: ProviderConfigSchema,

  // Memory
  memory: MemoryConfigSchema,

  // Sandbox
  sandbox: SandboxConfigSchema,

  // Logging
  logging: LoggingConfigSchema,
})
```

### Section Schemas

#### Owner

```typescript
const OwnerConfigSchema = z.object({
  // Display name for the owner
  displayName: z.string().min(1).max(100),

  // Timezone for scheduling (future)
  timezone: z.string().default('UTC'),

  // Locale for formatting
  locale: z.string().default('en-US'),
})
```

#### Server

```typescript
const ServerConfigSchema = z.object({
  // Bind address
  host: z.string().ip().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(3000),

  // TLS (optional)
  tls: z.object({
    enabled: z.boolean().default(false),
    cert: z.string().optional(),   // Path to cert file
    key: z.string().optional(),    // Path to key file
  }).optional(),

  // CORS
  cors: z.object({
    enabled: z.boolean().default(false),
    origins: z.array(z.string()).default([]),
  }).optional(),

  // Rate limiting
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    requestsPerMinute: z.number().int().positive().default(60),
    requestsPerHour: z.number().int().positive().default(1000),
  }).optional(),

  // Request limits
  maxRequestSize: z.string().default('1mb'),
  timeout: z.number().int().positive().default(120000),
})
```

#### Channels

```typescript
const ChannelConfigSchema = z.object({
  enabled: z.boolean().default(true),

  // DM policy
  dmPolicy: z.enum([
    'owner_only',
    'allowlist',
    'pairing',
    'open',
  ]).default('owner_only'),

  allowedUsers: z.array(z.string()).optional(),

  // Rate limiting (per channel)
  rateLimit: z.object({
    maxPerMinute: z.number().int().positive().default(30),
    maxPerHour: z.number().int().positive().default(500),
  }).optional(),
})

// Channel-specific extensions in INTERFACES.md:
// TelegramConfigSchema, DiscordConfigSchema, CLIConfigSchema
```

#### Providers

```typescript
const ProviderConfigSchema = z.object({
  // Primary provider (required)
  primary: z.object({
    type: z.enum(['anthropic', 'openai', 'ollama']),
    model: z.string(),
    // API key stored in credentials.enc, referenced here
    apiKeyRef: z.string().optional(),  // e.g., 'anthropic_api_key'
    baseUrl: z.string().url().optional(),
    maxTokens: z.number().int().positive().default(4096),
    temperature: z.number().min(0).max(2).default(0.7),
  }),

  // Fallback provider (optional)
  fallback: z.object({
    type: z.enum(['anthropic', 'openai', 'ollama']),
    model: z.string(),
    apiKeyRef: z.string().optional(),
    baseUrl: z.string().url().optional(),
  }).optional(),

  // Offline provider (optional, for local models)
  offline: z.object({
    type: z.literal('ollama'),
    model: z.string(),
    baseUrl: z.string().url().default('http://localhost:11434'),
  }).optional(),

  // Retry settings
  retry: z.object({
    maxRetries: z.number().int().min(0).max(10).default(3),
    retryDelay: z.number().int().positive().default(1000),
    exponentialBackoff: z.boolean().default(true),
  }).optional(),
})
```

#### Memory

```typescript
const MemoryConfigSchema = z.object({
  // Episodic memory
  episodic: z.object({
    enabled: z.boolean().default(true),
    ttlDays: z.number().int().positive().default(90),
    maxEntries: z.number().int().positive().default(10000),
  }),

  // Semantic memory
  semantic: z.object({
    enabled: z.boolean().default(true),
    maxEntries: z.number().int().positive().default(1000),
  }),

  // Embeddings
  embeddings: z.object({
    provider: z.enum(['openai', 'ollama', 'local']).default('openai'),
    model: z.string().default('text-embedding-3-small'),
    apiKeyRef: z.string().optional(),
  }),

  // Database
  database: z.object({
    type: z.enum(['sqlite', 'postgres']).default('sqlite'),
    // For postgres
    connectionString: z.string().optional(),
    // For sqlite
    path: z.string().optional(),
  }).optional(),
})
```

#### Sandbox

```typescript
const SandboxConfigSchema = z.object({
  // Bash sandbox settings
  bash: z.object({
    enabled: z.boolean().default(true),
    defaultNetwork: z.enum(['none', 'proxy']).default('none'),
    proxyAllowlist: z.array(z.string()).optional(),
    resources: z.object({
      memory: z.string().default('512m'),
      cpus: z.number().positive().default(1),
      timeout: z.number().int().positive().default(120000),
      pidsLimit: z.number().int().positive().default(100),
    }).optional(),
  }).optional(),

  // Container images
  images: z.object({
    default: z.string().default('meao-sandbox:latest'),
    node: z.string().optional(),
    python: z.string().optional(),
  }).optional(),

  // Docker socket
  dockerSocket: z.string().default('/var/run/docker.sock'),
})
```

#### Logging

```typescript
const LoggingConfigSchema = z.object({
  // Log level
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Output destinations
  console: z.boolean().default(true),
  file: z.object({
    enabled: z.boolean().default(true),
    path: z.string().optional(),  // Default: ~/.meao/logs/app.log
    maxSize: z.string().default('10m'),
    maxFiles: z.number().int().positive().default(5),
  }).optional(),

  // Formatting
  format: z.enum(['json', 'pretty']).default('json'),
  timestamps: z.boolean().default(true),

  // Audit log (separate)
  audit: z.object({
    enabled: z.boolean().default(true),
    path: z.string().optional(),  // Default: ~/.meao/logs/audit/
    retention: z.object({
      debug: z.string().default('7d'),
      info: z.string().default('30d'),
      warning: z.string().default('90d'),
      alert: z.string().default('1y'),
      critical: z.string().default('forever'),
    }).optional(),
  }).optional(),
})
```

---

## Environment Variables

### Naming Convention

```
MEAO_<SECTION>_<KEY>=value
MEAO_<SECTION>__<NESTED>__<KEY>=value  (double underscore for nesting)
```

### Common Variables

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `MEAO_HOME` | N/A | Override config directory |
| `MEAO_SERVER_HOST` | `server.host` | Bind address |
| `MEAO_SERVER_PORT` | `server.port` | Listen port |
| `MEAO_LOGGING_LEVEL` | `logging.level` | Log level |
| `MEAO_PROVIDERS__PRIMARY__TYPE` | `providers.primary.type` | Primary provider |
| `MEAO_PROVIDERS__PRIMARY__MODEL` | `providers.primary.model` | Primary model |

### Credential Variables

Credentials can be provided via environment (for containerized deployments):

```bash
# These override apiKeyRef lookups
MEAO_ANTHROPIC_API_KEY=sk-ant-...
MEAO_OPENAI_API_KEY=sk-...
MEAO_TELEGRAM_BOT_TOKEN=123456:ABC...
```

### Environment Parsing

```typescript
// Reserved environment variables (not parsed into config)
const RESERVED_ENV_VARS = new Set(['MEAO_HOME'])

// Credential override pattern: MEAO_<PROVIDER>_API_KEY or MEAO_<SERVICE>_TOKEN
// These are handled by resolveCredential(), not config parsing
const CREDENTIAL_ENV_PATTERN = /^MEAO_[A-Z]+_(API_KEY|BOT_TOKEN|TOKEN)$/

function parseEnvConfig(): Partial<AppConfig> {
  const config: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('MEAO_')) continue

    // Skip reserved variables (handled elsewhere)
    if (RESERVED_ENV_VARS.has(key)) continue

    // Skip credential override variables (handled by resolveCredential)
    if (CREDENTIAL_ENV_PATTERN.test(key)) continue

    // Remove prefix and convert to config path
    // Convention: MEAO_SECTION_KEY or MEAO_SECTION__NESTED__KEY
    const path = key
      .slice(5)  // Remove 'MEAO_'
      .toLowerCase()
      .replace(/__/g, '.')  // Double underscore = explicit deep nesting
      .replace(/_/g, '.')   // Single underscore = section separator

    // Set nested value
    setPath(config, path, parseValue(value))
  }

  return config
}

function parseValue(value: string): unknown {
  // Boolean
  if (value === 'true') return true
  if (value === 'false') return false

  // Number
  if (/^\d+$/.test(value)) return parseInt(value)
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value)

  // JSON (for arrays/objects)
  if (value.startsWith('[') || value.startsWith('{')) {
    try { return JSON.parse(value) } catch {}
  }

  // String
  return value
}
```

---

## CLI Arguments

### Global Flags

```bash
meao [command] [options]

Global options:
  --config <path>       Use specific config file
  --home <path>         Override MEAO_HOME
  --log-level <level>   Override log level
  --no-color            Disable colored output
  --json                Output in JSON format
```

### Argument Precedence

```typescript
function loadConfig(cliArgs: CLIArgs): AppConfig {
  // 1. Load defaults
  let config = getDefaults()

  // 2. Merge file config
  const fileConfig = loadConfigFile(cliArgs.config ?? getConfigPath())
  config = deepMerge(config, fileConfig)

  // 3. Merge local overrides
  const localPath = getConfigPath().replace('.json', '.local.json')
  if (existsSync(localPath)) {
    const localConfig = loadConfigFile(localPath)
    config = deepMerge(config, localConfig)
  }

  // 4. Merge environment
  const envConfig = parseEnvConfig()
  config = deepMerge(config, envConfig)

  // 5. Merge CLI arguments
  const cliConfig = parseCLIConfig(cliArgs)
  config = deepMerge(config, cliConfig)

  // 6. Validate final config
  return AppConfigSchema.parse(config)
}
```

---

## Credential Storage

Credentials are stored separately in encrypted form. See [KEY_MANAGEMENT.md](./KEY_MANAGEMENT.md).

### Credential References

Config references credentials by name:

```json
{
  "channels": {
    "telegram": {
      "botTokenRef": "telegram_bot_token"
    }
  },
  "providers": {
    "primary": {
      "type": "anthropic",
      "apiKeyRef": "anthropic_api_key"
    }
  }
}
```

### Setting Credentials

```bash
# Interactive (prompts for value, never echoed)
meao config set-secret telegram_bot_token

# From environment (for automation)
MEAO_SECRET_VALUE=... meao config set-secret telegram_bot_token

# List stored credentials (names only, not values)
meao config list-secrets
```

### Credential Resolution

```typescript
async function resolveCredential(ref: string): Promise<string> {
  // 1. Check environment override
  const envKey = `MEAO_${ref.toUpperCase()}`
  if (process.env[envKey]) {
    return process.env[envKey]
  }

  // 2. Load from encrypted store
  const store = await getCredentialStore()
  const value = await store.get(ref)

  if (!value) {
    throw new ConfigError(`Credential '${ref}' not found`)
  }

  return value
}
```

---

## Validation

### Startup Validation

```typescript
async function validateConfig(config: AppConfig): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 1. Schema validation (already done by Zod)

  // 2. Semantic validation

  // Check required credentials exist
  for (const [name, channel] of Object.entries(config.channels)) {
    if (channel.enabled && channel.botTokenRef) {
      if (!await credentialExists(channel.botTokenRef)) {
        errors.push({
          path: `channels.${name}.botTokenRef`,
          message: `Credential '${channel.botTokenRef}' not found`,
        })
      }
    }
  }

  // Check provider configuration
  if (config.providers.primary.apiKeyRef) {
    if (!await credentialExists(config.providers.primary.apiKeyRef)) {
      errors.push({
        path: 'providers.primary.apiKeyRef',
        message: `Credential '${config.providers.primary.apiKeyRef}' not found`,
      })
    }
  }

  // Check paths exist
  if (config.server.tls?.enabled) {
    if (!existsSync(config.server.tls.cert)) {
      errors.push({
        path: 'server.tls.cert',
        message: `TLS cert file not found: ${config.server.tls.cert}`,
      })
    }
  }

  // Warnings for suboptimal config
  if (config.server.host === '0.0.0.0') {
    warnings.push({
      path: 'server.host',
      message: 'Binding to all interfaces. Ensure firewall is configured.',
    })
  }

  if (config.channels.telegram?.dmPolicy === 'open') {
    warnings.push({
      path: 'channels.telegram.dmPolicy',
      message: 'DM policy is "open". Anyone can message your bot.',
    })
  }

  return { valid: errors.length === 0, errors, warnings }
}
```

### Error Messages

Validation errors include helpful context:

```
Configuration error at 'providers.primary.model':

  Expected string, received undefined

  The 'model' field is required when using provider type 'anthropic'.
  Example values: 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'

  To fix, add to your config.json:
  {
    "providers": {
      "primary": {
        "type": "anthropic",
        "model": "claude-sonnet-4-20250514"  // <-- add this
      }
    }
  }
```

---

## Hot Reload

Some settings can be changed without restart:

### Hot-Reloadable

| Setting | Notes |
|---------|-------|
| `logging.level` | Immediate effect |
| `logging.format` | Immediate effect |
| `tools.*.capability` | Next tool execution |
| `sandbox.bash.resources` | Next sandbox creation |
| `memory.episodic.ttlDays` | Next cleanup run |

### Requires Restart

| Setting | Notes |
|---------|-------|
| `server.host` | Server must rebind |
| `server.port` | Server must rebind |
| `server.tls` | Server must reinitialize |
| `channels.*` | Channels must reconnect |
| `providers.*` | Provider clients must reinitialize |
| `keyManagement.*` | Security-critical |

### Hot Reload Implementation

```typescript
class ConfigManager {
  private config: AppConfig
  private watchers: Map<string, () => void> = new Map()

  async watchConfig(): Promise<void> {
    const configPath = getConfigPath()

    fs.watch(configPath, async () => {
      try {
        const newConfig = await loadConfig()
        const diff = diffConfigs(this.config, newConfig)

        // Apply hot-reloadable changes
        for (const change of diff) {
          if (isHotReloadable(change.path)) {
            this.applyChange(change)
            this.emit('config:changed', change)
          } else {
            this.emit('config:restart-required', change)
          }
        }

        this.config = newConfig
      } catch (error) {
        this.emit('config:error', error)
      }
    })
  }
}
```

---

## Default Configuration

### Minimal Config (First Run)

```json
{
  "version": 1,
  "owner": {
    "displayName": "Owner"
  },
  "providers": {
    "primary": {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKeyRef": "anthropic_api_key"
    }
  }
}
```

### Full Example Config

```json
{
  "version": 1,
  "owner": {
    "displayName": "Alex",
    "timezone": "America/New_York",
    "locale": "en-US"
  },
  "keyManagement": {
    "kekSource": "passphrase"
  },
  "server": {
    "host": "127.0.0.1",
    "port": 3000,
    "rateLimit": {
      "enabled": true,
      "requestsPerMinute": 60
    }
  },
  "channels": {
    "cli": {
      "enabled": true,
      "prompt": "meao> ",
      "colors": true
    },
    "telegram": {
      "enabled": true,
      "botTokenRef": "telegram_bot_token",
      "dmPolicy": "owner_only",
      "mode": "polling"
    }
  },
  "skills": {
    "coder": {
      "enabled": true,
      "priority": 10
    },
    "research": {
      "enabled": true,
      "priority": 5
    }
  },
  "tools": {
    "bash": {
      "enabled": true,
      "capability": {
        "approval": { "level": "ask" },
        "execution": { "sandbox": "container" }
      }
    },
    "read": {
      "enabled": true,
      "capability": {
        "execution": {
          "allowedPaths": ["$WORKSPACE", "$HOME/Documents"]
        }
      }
    }
  },
  "providers": {
    "primary": {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKeyRef": "anthropic_api_key",
      "maxTokens": 4096,
      "temperature": 0.7
    },
    "fallback": {
      "type": "openai",
      "model": "gpt-4-turbo",
      "apiKeyRef": "openai_api_key"
    },
    "offline": {
      "type": "ollama",
      "model": "llama2",
      "baseUrl": "http://localhost:11434"
    }
  },
  "memory": {
    "episodic": {
      "enabled": true,
      "ttlDays": 90
    },
    "semantic": {
      "enabled": true
    },
    "embeddings": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "apiKeyRef": "openai_api_key"
    }
  },
  "sandbox": {
    "bash": {
      "defaultNetwork": "none",
      "proxyAllowlist": [
        "*.github.com",
        "*.npmjs.org"
      ],
      "resources": {
        "memory": "512m",
        "timeout": 120000
      }
    }
  },
  "logging": {
    "level": "info",
    "format": "json",
    "file": {
      "enabled": true,
      "maxSize": "10m",
      "maxFiles": 5
    },
    "audit": {
      "enabled": true
    }
  }
}
```

---

## CLI Commands

```bash
# View current config
meao config show
meao config show --section providers
meao config show server.port

# Set values
meao config set server.port 3001
meao config set logging.level debug

# Reset to default
meao config reset server.port
meao config reset --section logging

# Validate config
meao config validate
meao config validate --strict  # Treat warnings as errors

# Edit in $EDITOR
meao config edit

# Credential management
meao config set-secret <name>
meao config list-secrets
meao config delete-secret <name>

# Export/import (excludes secrets)
meao config export > config-backup.json
meao config import config-backup.json
```

---

## Migration

When schema changes between versions:

```typescript
interface Migration {
  fromVersion: number
  toVersion: number
  migrate(config: unknown): unknown
}

const MIGRATIONS: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate(config) {
      // Example: rename field
      if (config.server?.bindAddress) {
        config.server.host = config.server.bindAddress
        delete config.server.bindAddress
      }
      return config
    },
  },
]

function migrateConfig(config: unknown): AppConfig {
  let currentVersion = config.version ?? 1

  while (currentVersion < CURRENT_VERSION) {
    const migration = MIGRATIONS.find(m => m.fromVersion === currentVersion)
    if (!migration) {
      throw new Error(`No migration from version ${currentVersion}`)
    }

    config = migration.migrate(config)
    currentVersion = migration.toVersion
    config.version = currentVersion
  }

  return AppConfigSchema.parse(config)
}
```

---

## Security Considerations

### Secure Defaults

All defaults follow secure-by-default principles:

| Setting | Default | Secure Reasoning |
|---------|---------|------------------|
| `server.host` | `127.0.0.1` | Localhost only |
| `channels.*.dmPolicy` | `owner_only` | No unauthorized access |
| `sandbox.bash.defaultNetwork` | `none` | No network by default |
| `tools.bash.capability.approval` | `ask` | Require approval |

### File Permissions

```bash
# Config file should be readable only by owner
chmod 600 ~/.meao/config.json

# Credentials must be owner-only
chmod 600 ~/.meao/credentials.enc
chmod 700 ~/.meao/keys/
```

### Config in Logs

Config values are redacted in logs:

```typescript
function redactConfigForLogging(config: AppConfig): unknown {
  return {
    ...config,
    // Redact credential references
    providers: {
      ...config.providers,
      primary: {
        ...config.providers.primary,
        apiKeyRef: config.providers.primary.apiKeyRef ? '[REDACTED]' : undefined,
      },
    },
    // Redact channel tokens
    channels: Object.fromEntries(
      Object.entries(config.channels).map(([k, v]) => [
        k,
        { ...v, botTokenRef: v.botTokenRef ? '[REDACTED]' : undefined },
      ])
    ),
  }
}
```

---

*This specification is living documentation. Update as configuration system evolves.*

*Last updated: 2026-01-29* (fixed env var parsing)
