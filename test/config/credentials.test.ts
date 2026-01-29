import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resolveCredential,
  credentialExists,
  CredentialStore,
  ConfigError,
} from '../../src/config/credentials.js'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

describe('resolveCredential', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear credential env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MEAO_') && (key.includes('API_KEY') || key.includes('TOKEN'))) {
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns env override when set', async () => {
    process.env.MEAO_TELEGRAM_BOT_TOKEN = 'test-token'
    const value = await resolveCredential('telegram_bot_token')
    expect(value).toBe('test-token')
  })

  it('returns env override for API key', async () => {
    process.env.MEAO_ANTHROPIC_API_KEY = 'sk-ant-xxx'
    const value = await resolveCredential('anthropic_api_key')
    expect(value).toBe('sk-ant-xxx')
  })

  it('throws ConfigError when credential not found', async () => {
    await expect(resolveCredential('nonexistent_key')).rejects.toThrow(ConfigError)
  })

  it('error message includes env var name', async () => {
    try {
      await resolveCredential('my_secret')
    } catch (error) {
      expect((error as Error).message).toContain('MEAO_MY_SECRET')
    }
  })
})

describe('credentialExists', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MEAO_') && key.includes('API_KEY')) {
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns true when env var exists', async () => {
    process.env.MEAO_TEST_API_KEY = 'test'
    expect(await credentialExists('test_api_key')).toBe(true)
  })

  it('returns false when credential not found', async () => {
    expect(await credentialExists('nonexistent')).toBe(false)
  })
})

describe('CredentialStore', () => {
  let testDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(async () => {
    originalEnv = { ...process.env }
    testDir = path.join(os.tmpdir(), `meao-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    process.env.MEAO_HOME = testDir
  })

  afterEach(async () => {
    process.env = originalEnv
    try {
      await fs.rm(testDir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('stores and retrieves a credential', async () => {
    const store = new CredentialStore()
    await store.set('test_key', 'test_value')
    expect(await store.get('test_key')).toBe('test_value')
  })

  it('returns undefined for missing credential', async () => {
    const store = new CredentialStore()
    expect(await store.get('nonexistent')).toBeUndefined()
  })

  it('deletes a credential', async () => {
    const store = new CredentialStore()
    await store.set('test_key', 'test_value')
    await store.delete('test_key')
    expect(await store.get('test_key')).toBeUndefined()
  })

  it('lists all credentials', async () => {
    const store = new CredentialStore()
    await store.set('key1', 'value1')
    await store.set('key2', 'value2')
    const keys = await store.list()
    expect(keys).toContain('key1')
    expect(keys).toContain('key2')
  })

  it('persists credentials to disk', async () => {
    const store1 = new CredentialStore()
    await store1.set('persistent_key', 'persistent_value')

    // Create a new store instance (simulates restart)
    const store2 = new CredentialStore()
    expect(await store2.get('persistent_key')).toBe('persistent_value')
  })
})
