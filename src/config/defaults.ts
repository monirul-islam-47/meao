import type { AppConfig } from './schema.js'

/**
 * Get the default configuration.
 * These values are used when no config file or env vars are set.
 */
export function getDefaults(): AppConfig {
  return {
    version: 1,
    owner: {
      displayName: 'Owner',
      timezone: 'UTC',
      locale: 'en-US',
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      maxRequestSize: '1mb',
      timeout: 120000,
    },
    channels: {},
    providers: {
      primary: {
        type: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        temperature: 0.7,
      },
    },
    memory: {},
    sandbox: {
      type: 'container',
    },
    logging: {
      level: 'info',
      format: 'json',
    },
    tools: {},
    skills: {},
  }
}
