import { describe, it, expect } from 'vitest'
import { AppConfigSchema } from '../../src/config/schema.js'

describe('AppConfigSchema', () => {
  it('parses empty object with defaults', () => {
    const config = AppConfigSchema.parse({})
    expect(config.version).toBe(1)
    expect(config.owner.displayName).toBe('Owner')
    expect(config.server.host).toBe('127.0.0.1')
    expect(config.server.port).toBe(3000)
    expect(config.logging.level).toBe('info')
  })

  it('parses valid config', () => {
    const config = AppConfigSchema.parse({
      version: 1,
      owner: {
        displayName: 'John',
        timezone: 'America/New_York',
      },
      server: {
        host: '0.0.0.0',
        port: 4000,
      },
    })
    expect(config.owner.displayName).toBe('John')
    expect(config.owner.timezone).toBe('America/New_York')
    expect(config.server.host).toBe('0.0.0.0')
    expect(config.server.port).toBe(4000)
  })

  it('rejects invalid port', () => {
    expect(() =>
      AppConfigSchema.parse({
        server: { port: 70000 },
      })
    ).toThrow()
  })

  it('rejects negative port', () => {
    expect(() =>
      AppConfigSchema.parse({
        server: { port: -1 },
      })
    ).toThrow()
  })

  it('rejects invalid log level', () => {
    expect(() =>
      AppConfigSchema.parse({
        logging: { level: 'invalid' },
      })
    ).toThrow()
  })

  it('accepts valid provider config', () => {
    const config = AppConfigSchema.parse({
      providers: {
        primary: {
          type: 'anthropic',
          model: 'claude-3-opus-20240229',
          maxTokens: 8192,
          temperature: 0.5,
        },
      },
    })
    expect(config.providers.primary.type).toBe('anthropic')
    expect(config.providers.primary.model).toBe('claude-3-opus-20240229')
  })

  it('accepts mock provider', () => {
    const config = AppConfigSchema.parse({
      providers: {
        primary: {
          type: 'mock',
        },
      },
    })
    expect(config.providers.primary.type).toBe('mock')
  })

  it('accepts channel config', () => {
    const config = AppConfigSchema.parse({
      channels: {
        telegram: {
          enabled: true,
          dmPolicy: 'owner_only',
          botTokenRef: 'telegram_bot_token',
        },
      },
    })
    expect(config.channels.telegram.enabled).toBe(true)
    expect(config.channels.telegram.dmPolicy).toBe('owner_only')
  })

  it('accepts sandbox config', () => {
    const config = AppConfigSchema.parse({
      sandbox: {
        type: 'container',
        container: {
          image: 'custom-sandbox:v1',
          memoryLimit: '1g',
        },
      },
    })
    expect(config.sandbox.type).toBe('container')
    expect(config.sandbox.container?.image).toBe('custom-sandbox:v1')
  })
})
