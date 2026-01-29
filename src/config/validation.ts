import type { AppConfig } from './schema.js'
import { credentialExists } from './credentials.js'

export interface ValidationError {
  path: string
  message: string
  suggestion?: string
}

export interface ValidationWarning {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

/**
 * Validate a configuration for semantic correctness.
 * This goes beyond Zod schema validation to check things like
 * credential existence and security settings.
 */
export async function validateConfig(
  config: AppConfig
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // Check required credentials exist
  if (config.providers.primary.apiKeyRef) {
    if (!(await credentialExists(config.providers.primary.apiKeyRef))) {
      errors.push({
        path: 'providers.primary.apiKeyRef',
        message: `Credential '${config.providers.primary.apiKeyRef}' not found`,
        suggestion: `Run: meao config set-secret ${config.providers.primary.apiKeyRef}`,
      })
    }
  }

  // Check fallback provider credentials
  if (config.providers.fallback?.apiKeyRef) {
    if (!(await credentialExists(config.providers.fallback.apiKeyRef))) {
      errors.push({
        path: 'providers.fallback.apiKeyRef',
        message: `Credential '${config.providers.fallback.apiKeyRef}' not found`,
        suggestion: `Run: meao config set-secret ${config.providers.fallback.apiKeyRef}`,
      })
    }
  }

  // Check channel credentials
  for (const [name, channel] of Object.entries(config.channels)) {
    if (channel.enabled && channel.botTokenRef) {
      if (!(await credentialExists(channel.botTokenRef))) {
        errors.push({
          path: `channels.${name}.botTokenRef`,
          message: `Credential '${channel.botTokenRef}' not found`,
          suggestion: `Run: meao config set-secret ${channel.botTokenRef}`,
        })
      }
    }
  }

  // Security warnings
  if (config.server.host === '0.0.0.0') {
    warnings.push({
      path: 'server.host',
      message: 'Binding to all interfaces. Ensure firewall is configured.',
    })
  }

  // TLS warnings
  if (config.server.tls?.enabled) {
    if (!config.server.tls.cert || !config.server.tls.key) {
      errors.push({
        path: 'server.tls',
        message: 'TLS enabled but cert or key path not provided',
      })
    }
  }

  // Sandbox warnings
  if (config.sandbox.type === 'process') {
    warnings.push({
      path: 'sandbox.type',
      message:
        'Process sandbox is less secure than container sandbox. Use container in production.',
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
