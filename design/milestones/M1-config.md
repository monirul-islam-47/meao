# Milestone 1: Configuration System

**Status:** COMPLETE
**Scope:** MVP
**Dependencies:** M0 (Repo Setup)
**PR:** PR1

---

## Goal

Implement the full configuration precedence chain with credential resolution. This is foundational - every other component depends on configuration.

**Spec Reference:** [CONFIG.md](../CONFIG.md)

---

## File Structure

```
src/config/
├── index.ts                   # Public exports
├── schema.ts                  # Zod schemas + AppConfig type
├── defaults.ts                # getDefaults()
├── paths.ts                   # getMeaoHome(), getConfigPath(), etc.
├── env.ts                     # parseEnvConfig(), parseValue()
├── file.ts                    # loadConfigFile(), saveConfigFile()
├── merge.ts                   # deepMerge()
├── loader.ts                  # loadConfig(cliArgs)
├── manager.ts                 # ConfigManager class
├── credentials.ts             # CredentialStore, resolveCredential()
├── validation.ts              # validateConfig() semantic checks
├── migration.ts               # Schema migrations
└── watch.ts                   # Hot-reload file watcher (Phase 2)
```

---

## Key Exports

```typescript
// src/config/index.ts
export { AppConfigSchema, type AppConfig } from './schema'
export { getDefaults } from './defaults'
export { getMeaoHome, getConfigPath, getCredentialsPath } from './paths'
export { loadConfig } from './loader'
export { ConfigManager } from './manager'
export { resolveCredential, CredentialStore } from './credentials'
export { validateConfig, type ValidationResult } from './validation'
```

---

## Implementation Requirements

### 1. Precedence Chain (loader.ts)

The configuration must be loaded in this exact order (later overrides earlier):

```typescript
export async function loadConfig(cliArgs: CLIArgs = {}): Promise<AppConfig> {
  // 1. Start with defaults
  let config = getDefaults()

  // 2. Merge user config file
  const configPath = cliArgs.config ?? getConfigPath()
  if (await fileExists(configPath)) {
    const fileConfig = await loadConfigFile(configPath)
    config = deepMerge(config, fileConfig)
  }

  // 3. Merge local overrides (config.local.json)
  const localPath = configPath.replace('.json', '.local.json')
  if (await fileExists(localPath)) {
    const localConfig = await loadConfigFile(localPath)
    config = deepMerge(config, localConfig)
  }

  // 4. Merge environment variables
  const envConfig = parseEnvConfig()
  config = deepMerge(config, envConfig)

  // 5. Merge CLI arguments
  const cliConfig = parseCLIConfig(cliArgs)
  config = deepMerge(config, cliConfig)

  // 6. Validate with Zod
  return AppConfigSchema.parse(config)
}
```

### 2. Environment Variable Parsing (env.ts)

```typescript
// Reserved environment variables (not parsed into config)
const RESERVED_ENV_VARS = new Set(['MEAO_HOME'])

// Credential override pattern: MEAO_<PROVIDER>_API_KEY or MEAO_<SERVICE>_TOKEN
const CREDENTIAL_ENV_PATTERN = /^MEAO_[A-Z]+_(API_KEY|BOT_TOKEN|TOKEN)$/

export function parseEnvConfig(): Partial<AppConfig> {
  const config: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('MEAO_')) continue

    // Skip reserved variables
    if (RESERVED_ENV_VARS.has(key)) continue

    // Skip credential overrides (handled by resolveCredential)
    if (CREDENTIAL_ENV_PATTERN.test(key)) continue

    // Convert to config path
    // MEAO_SERVER_HOST -> server.host
    // MEAO_PROVIDERS__PRIMARY__TYPE -> providers.primary.type
    const path = key
      .slice(5)  // Remove 'MEAO_'
      .toLowerCase()
      .replace(/__/g, '.')  // Double underscore = deep nesting
      .replace(/_/g, '.')   // Single underscore = section separator

    setPath(config, path, parseValue(value))
  }

  return config
}

export function parseValue(value: string): unknown {
  // Boolean
  if (value === 'true') return true
  if (value === 'false') return false

  // Integer
  if (/^\d+$/.test(value)) return parseInt(value, 10)

  // Float
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value)

  // JSON (arrays/objects)
  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      return JSON.parse(value)
    } catch {
      // Fall through to string
    }
  }

  // String
  return value
}
```

### 3. Path Resolution (paths.ts)

```typescript
export function getMeaoHome(): string {
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

export function getConfigPath(): string {
  return path.join(getMeaoHome(), 'config.json')
}

export function getCredentialsPath(): string {
  return path.join(getMeaoHome(), 'credentials.json')
}

export function getLogsPath(): string {
  return path.join(getMeaoHome(), 'logs')
}

export function getAuditPath(): string {
  return path.join(getLogsPath(), 'audit')
}
```

### 4. Credential Resolution (credentials.ts)

```typescript
export async function resolveCredential(ref: string): Promise<string> {
  // 1. Check environment override first
  // telegram_bot_token -> MEAO_TELEGRAM_BOT_TOKEN
  const envKey = `MEAO_${ref.toUpperCase()}`
  if (process.env[envKey]) {
    return process.env[envKey]
  }

  // 2. Load from encrypted store
  const store = await getCredentialStore()
  const value = await store.get(ref)

  if (!value) {
    throw new ConfigError(
      `Credential '${ref}' not found. ` +
      `Set via environment (${envKey}) or run: meao config set-secret ${ref}`
    )
  }

  return value
}

export class CredentialStore {
  private cache: Map<string, string> = new Map()

  async get(name: string): Promise<string | undefined> {
    if (this.cache.has(name)) {
      return this.cache.get(name)
    }

    // Load from encrypted file
    const credentials = await this.loadCredentials()
    return credentials[name]
  }

  async set(name: string, value: string): Promise<void> {
    const credentials = await this.loadCredentials()
    credentials[name] = value
    await this.saveCredentials(credentials)
    this.cache.set(name, value)
  }

  async delete(name: string): Promise<void> {
    const credentials = await this.loadCredentials()
    delete credentials[name]
    await this.saveCredentials(credentials)
    this.cache.delete(name)
  }

  async list(): Promise<string[]> {
    const credentials = await this.loadCredentials()
    return Object.keys(credentials)
  }

  // MVP: Simple file-based storage
  // Phase 2: Proper encryption with KEK/DEK
  private async loadCredentials(): Promise<Record<string, string>> {
    const credPath = getCredentialsPath()
    if (!await fileExists(credPath)) {
      return {}
    }
    const content = await fs.readFile(credPath, 'utf-8')
    return JSON.parse(content)
  }

  private async saveCredentials(credentials: Record<string, string>): Promise<void> {
    const credPath = getCredentialsPath()
    await fs.mkdir(path.dirname(credPath), { recursive: true })
    await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,  // Owner read/write only
    })
  }
}
```

### 5. Deep Merge (merge.ts)

```typescript
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target }

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      // Recursively merge objects
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T]
    } else if (sourceValue !== undefined) {
      // Override with source value
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}
```

### 6. Validation (validation.ts)

```typescript
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export async function validateConfig(config: AppConfig): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // Check required credentials exist
  if (config.providers.primary.apiKeyRef) {
    if (!await credentialExists(config.providers.primary.apiKeyRef)) {
      errors.push({
        path: 'providers.primary.apiKeyRef',
        message: `Credential '${config.providers.primary.apiKeyRef}' not found`,
        suggestion: `Run: meao config set-secret ${config.providers.primary.apiKeyRef}`,
      })
    }
  }

  // Check channel credentials
  for (const [name, channel] of Object.entries(config.channels ?? {})) {
    if (channel.enabled && channel.botTokenRef) {
      if (!await credentialExists(channel.botTokenRef)) {
        errors.push({
          path: `channels.${name}.botTokenRef`,
          message: `Credential '${channel.botTokenRef}' not found`,
        })
      }
    }
  }

  // Security warnings
  if (config.server?.host === '0.0.0.0') {
    warnings.push({
      path: 'server.host',
      message: 'Binding to all interfaces. Ensure firewall is configured.',
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
```

---

## Tests

```
test/config/
├── schema.test.ts             # Zod validation edge cases
├── env.test.ts                # Env var parsing
├── precedence.test.ts         # Full precedence chain
├── credentials.test.ts        # Credential resolution
├── merge.test.ts              # Deep merge
├── paths.test.ts              # Path resolution
└── validation.test.ts         # Semantic validation
```

### Critical Test Cases

```typescript
// test/config/env.test.ts
describe('parseEnvConfig', () => {
  it('converts MEAO_SERVER_HOST to server.host', () => {
    process.env.MEAO_SERVER_HOST = '0.0.0.0'
    const config = parseEnvConfig()
    expect(config.server?.host).toBe('0.0.0.0')
  })

  it('converts MEAO_PROVIDERS__PRIMARY__TYPE to providers.primary.type', () => {
    process.env.MEAO_PROVIDERS__PRIMARY__TYPE = 'anthropic'
    const config = parseEnvConfig()
    expect(config.providers?.primary?.type).toBe('anthropic')
  })

  it('skips MEAO_HOME', () => {
    process.env.MEAO_HOME = '/custom/path'
    const config = parseEnvConfig()
    expect(config).not.toHaveProperty('home')
  })

  it('skips MEAO_ANTHROPIC_API_KEY', () => {
    process.env.MEAO_ANTHROPIC_API_KEY = 'sk-ant-xxx'
    const config = parseEnvConfig()
    expect(config).not.toHaveProperty('anthropic')
  })

  it('parses boolean true', () => {
    expect(parseValue('true')).toBe(true)
  })

  it('parses boolean false', () => {
    expect(parseValue('false')).toBe(false)
  })

  it('parses integers', () => {
    expect(parseValue('3000')).toBe(3000)
  })

  it('parses floats', () => {
    expect(parseValue('0.7')).toBe(0.7)
  })

  it('parses JSON arrays', () => {
    expect(parseValue('["a","b"]')).toEqual(['a', 'b'])
  })

  it('returns string for invalid JSON', () => {
    expect(parseValue('[invalid')).toBe('[invalid')
  })
})

// test/config/precedence.test.ts
describe('loadConfig precedence', () => {
  it('CLI overrides environment', async () => {
    process.env.MEAO_SERVER_PORT = '3000'
    const config = await loadConfig({ port: 4000 })
    expect(config.server.port).toBe(4000)
  })

  it('environment overrides user config', async () => {
    // Setup user config with port 3000
    // Set env MEAO_SERVER_PORT=4000
    // Expect port 4000
  })

  it('user config overrides defaults', async () => {
    // Defaults have port 3000
    // User config has port 4000
    // Expect port 4000
  })

  it('local config overrides main config', async () => {
    // config.json has port 3000
    // config.local.json has port 4000
    // Expect port 4000
  })
})

// test/config/credentials.test.ts
describe('resolveCredential', () => {
  it('returns env override when set', async () => {
    process.env.MEAO_TELEGRAM_BOT_TOKEN = 'test-token'
    const value = await resolveCredential('telegram_bot_token')
    expect(value).toBe('test-token')
  })

  it('throws ConfigError when credential not found', async () => {
    await expect(resolveCredential('nonexistent'))
      .rejects.toThrow(ConfigError)
  })
})
```

---

## CLI Commands (Stub for M6)

```bash
meao config show [path]        # View config
meao config set <path> <value> # Set value
meao config reset [path]       # Reset to default
meao config validate           # Validate config
meao config edit               # Open in $EDITOR

meao config set-secret <name>  # Set credential (interactive)
meao config list-secrets       # List credential names
meao config delete-secret <name>
```

---

## Definition of Done

- [ ] `loadConfig()` implements exact precedence chain
- [ ] Environment parsing handles `_` and `__` correctly
- [ ] MEAO_HOME is excluded from config parsing
- [ ] Credential env vars (MEAO_*_API_KEY, MEAO_*_TOKEN) are excluded
- [ ] `resolveCredential()` checks env override first
- [ ] `validateConfig()` returns actionable errors
- [ ] Credentials stored with 0600 permissions
- [ ] All tests pass
- [ ] `pnpm check` passes

---

## PR Checklist

```markdown
## PR1: Configuration System

### Changes
- [ ] Add config schema (Zod)
- [ ] Implement precedence chain loader
- [ ] Implement env var parsing
- [ ] Implement credential store (simple file-based for MVP)
- [ ] Add path resolution helpers
- [ ] Add validation

### Tests
- [ ] Env parsing tests
- [ ] Precedence tests
- [ ] Credential resolution tests

### Verification
- [ ] Can load config from file + env + CLI
- [ ] Credentials resolve from env override
- [ ] `pnpm check` passes
```

---

## Next Milestone

After completing M1, proceed to [M1.5: Audit (Thin)](./M1.5-audit-thin.md).

---

*Last updated: 2026-01-29*
