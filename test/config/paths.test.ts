import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getMeaoHome,
  getConfigPath,
  getCredentialsPath,
  getLogsPath,
  getAuditPath,
} from '../../src/config/paths.js'

describe('getMeaoHome', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.MEAO_HOME
    delete process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns MEAO_HOME when set', () => {
    process.env.MEAO_HOME = '/custom/meao'
    expect(getMeaoHome()).toBe('/custom/meao')
  })

  it('returns XDG_CONFIG_HOME/meao on Linux when set', () => {
    process.env.XDG_CONFIG_HOME = '/home/user/.config'
    expect(getMeaoHome()).toBe('/home/user/.config/meao')
  })

  it('returns platform default when no env vars set', () => {
    const result = getMeaoHome()
    // Just verify it returns a valid path
    expect(result).toBeTruthy()
    expect(result.includes('meao')).toBe(true)
  })
})

describe('getConfigPath', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.MEAO_HOME = '/test/meao'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns config.json in MEAO_HOME', () => {
    expect(getConfigPath()).toBe('/test/meao/config.json')
  })
})

describe('getCredentialsPath', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.MEAO_HOME = '/test/meao'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns credentials.json in MEAO_HOME', () => {
    expect(getCredentialsPath()).toBe('/test/meao/credentials.json')
  })
})

describe('getLogsPath', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.MEAO_HOME = '/test/meao'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns logs directory in MEAO_HOME', () => {
    expect(getLogsPath()).toBe('/test/meao/logs')
  })
})

describe('getAuditPath', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.MEAO_HOME = '/test/meao'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns audit directory in logs', () => {
    expect(getAuditPath()).toBe('/test/meao/logs/audit')
  })
})
