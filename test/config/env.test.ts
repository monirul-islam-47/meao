import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseEnvConfig, parseValue } from '../../src/config/env.js'

describe('parseValue', () => {
  it('parses boolean true', () => {
    expect(parseValue('true')).toBe(true)
  })

  it('parses boolean false', () => {
    expect(parseValue('false')).toBe(false)
  })

  it('parses positive integers', () => {
    expect(parseValue('3000')).toBe(3000)
  })

  it('parses negative integers', () => {
    expect(parseValue('-42')).toBe(-42)
  })

  it('parses floats', () => {
    expect(parseValue('0.7')).toBe(0.7)
  })

  it('parses negative floats', () => {
    expect(parseValue('-3.14')).toBe(-3.14)
  })

  it('parses JSON arrays', () => {
    expect(parseValue('["a","b"]')).toEqual(['a', 'b'])
  })

  it('parses JSON objects', () => {
    expect(parseValue('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('returns string for invalid JSON', () => {
    expect(parseValue('[invalid')).toBe('[invalid')
  })

  it('returns string for regular text', () => {
    expect(parseValue('hello world')).toBe('hello world')
  })
})

describe('parseEnvConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear MEAO_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MEAO_')) {
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
  })

  it('converts MEAO_SERVER_HOST to server.host', () => {
    process.env.MEAO_SERVER_HOST = '0.0.0.0'
    const config = parseEnvConfig()
    expect(config.server?.host).toBe('0.0.0.0')
  })

  it('converts MEAO_SERVER_PORT to server.port', () => {
    process.env.MEAO_SERVER_PORT = '4000'
    const config = parseEnvConfig()
    expect(config.server?.port).toBe(4000)
  })

  it('converts MEAO_PROVIDERS__PRIMARY__TYPE to providers.primary.type', () => {
    process.env.MEAO_PROVIDERS__PRIMARY__TYPE = 'anthropic'
    const config = parseEnvConfig()
    expect((config.providers as Record<string, unknown>)?.primary).toEqual({
      type: 'anthropic',
    })
  })

  it('skips MEAO_HOME (reserved)', () => {
    process.env.MEAO_HOME = '/custom/path'
    const config = parseEnvConfig()
    expect(config).not.toHaveProperty('home')
  })

  it('skips MEAO_ANTHROPIC_API_KEY (credential)', () => {
    process.env.MEAO_ANTHROPIC_API_KEY = 'sk-ant-xxx'
    const config = parseEnvConfig()
    expect(config).not.toHaveProperty('anthropic')
  })

  it('skips MEAO_TELEGRAM_BOT_TOKEN (credential)', () => {
    process.env.MEAO_TELEGRAM_BOT_TOKEN = 'token123'
    const config = parseEnvConfig()
    expect(config).not.toHaveProperty('telegram')
  })

  it('parses boolean values', () => {
    process.env.MEAO_LOGGING_AUDIT__ENABLED = 'true'
    const config = parseEnvConfig()
    expect((config.logging as Record<string, unknown>)?.audit).toEqual({
      enabled: true,
    })
  })
})
