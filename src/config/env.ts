import type { AppConfig } from './schema.js'
import { setPath } from './merge.js'

// Reserved environment variables (not parsed into config)
const RESERVED_ENV_VARS = new Set(['MEAO_HOME'])

// Credential override pattern: MEAO_<PROVIDER>_API_KEY or MEAO_<SERVICE>_TOKEN
const CREDENTIAL_ENV_PATTERN = /^MEAO_[A-Z_]+_(API_KEY|BOT_TOKEN|TOKEN)$/

/**
 * Parse environment variables into a partial config object.
 *
 * Naming conventions:
 * - MEAO_SERVER_HOST -> server.host (single underscore = property separator)
 * - MEAO_PROVIDERS__PRIMARY__TYPE -> providers.primary.type (double underscore = deep nesting)
 *
 * Reserved variables (not parsed):
 * - MEAO_HOME (used for path resolution)
 * - MEAO_*_API_KEY, MEAO_*_TOKEN (credential overrides)
 */
export function parseEnvConfig(): Partial<AppConfig> {
  const config: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('MEAO_')) continue
    if (value === undefined) continue

    // Skip reserved variables
    if (RESERVED_ENV_VARS.has(key)) continue

    // Skip credential overrides (handled by resolveCredential)
    if (CREDENTIAL_ENV_PATTERN.test(key)) continue

    // Convert to config path
    // MEAO_SERVER_HOST -> server.host
    // MEAO_PROVIDERS__PRIMARY__TYPE -> providers.primary.type
    const path = key
      .slice(5) // Remove 'MEAO_'
      .toLowerCase()
      .replace(/__/g, '.') // Double underscore = deep nesting
      .replace(/_/g, '.') // Single underscore = section separator

    setPath(config, path, parseValue(value))
  }

  return config as Partial<AppConfig>
}

/**
 * Parse a string value to its appropriate type.
 */
export function parseValue(value: string): unknown {
  // Boolean
  if (value === 'true') return true
  if (value === 'false') return false

  // Integer
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)

  // Float
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)

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

/**
 * Parse CLI arguments into a partial config object.
 */
export function parseCLIConfig(args: CLIArgs): Partial<AppConfig> {
  const config: Record<string, unknown> = {}

  if (args.port !== undefined) {
    setPath(config, 'server.port', args.port)
  }

  if (args.host !== undefined) {
    setPath(config, 'server.host', args.host)
  }

  if (args.logLevel !== undefined) {
    setPath(config, 'logging.level', args.logLevel)
  }

  return config as Partial<AppConfig>
}

export interface CLIArgs {
  config?: string
  port?: number
  host?: string
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}
