import { promises as fs } from 'fs'
import path from 'path'
import { getCredentialsPath } from './paths.js'
import { fileExists } from './file.js'

/**
 * Error thrown when a credential cannot be resolved.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Resolve a credential by name.
 * Resolution order:
 * 1. Environment variable (MEAO_<NAME>)
 * 2. Credential store
 */
export async function resolveCredential(ref: string): Promise<string> {
  // 1. Check environment override first
  // telegram_bot_token -> MEAO_TELEGRAM_BOT_TOKEN
  const envKey = `MEAO_${ref.toUpperCase()}`
  if (process.env[envKey]) {
    return process.env[envKey]!
  }

  // 2. Load from credential store
  const store = await getCredentialStore()
  const value = await store.get(ref)

  if (!value) {
    throw new ConfigError(
      `Credential '${ref}' not found. ` +
        `Set via environment (${envKey}) or run: meao config set-secret ${ref}`,
      ref
    )
  }

  return value
}

/**
 * Check if a credential exists.
 */
export async function credentialExists(ref: string): Promise<boolean> {
  // Check env first
  const envKey = `MEAO_${ref.toUpperCase()}`
  if (process.env[envKey]) {
    return true
  }

  // Check store
  const store = await getCredentialStore()
  const value = await store.get(ref)
  return value !== undefined
}

let credentialStoreInstance: CredentialStore | null = null

/**
 * Get the singleton credential store instance.
 */
export async function getCredentialStore(): Promise<CredentialStore> {
  if (!credentialStoreInstance) {
    credentialStoreInstance = new CredentialStore()
  }
  return credentialStoreInstance
}

/**
 * Simple file-based credential store.
 * MVP: Plain JSON storage with file permissions.
 * Phase 2: Proper encryption with KEK/DEK.
 */
export class CredentialStore {
  private cache: Map<string, string> = new Map()
  private loaded = false

  async get(name: string): Promise<string | undefined> {
    await this.ensureLoaded()
    return this.cache.get(name)
  }

  async set(name: string, value: string): Promise<void> {
    await this.ensureLoaded()
    this.cache.set(name, value)
    await this.save()
  }

  async delete(name: string): Promise<void> {
    await this.ensureLoaded()
    this.cache.delete(name)
    await this.save()
  }

  async list(): Promise<string[]> {
    await this.ensureLoaded()
    return Array.from(this.cache.keys())
  }

  async has(name: string): Promise<boolean> {
    await this.ensureLoaded()
    return this.cache.has(name)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    const credPath = getCredentialsPath()
    if (await fileExists(credPath)) {
      const content = await fs.readFile(credPath, 'utf-8')
      const data = JSON.parse(content) as Record<string, string>
      for (const [key, value] of Object.entries(data)) {
        this.cache.set(key, value)
      }
    }

    this.loaded = true
  }

  private async save(): Promise<void> {
    const credPath = getCredentialsPath()
    await fs.mkdir(path.dirname(credPath), { recursive: true })

    const data: Record<string, string> = {}
    for (const [key, value] of this.cache.entries()) {
      data[key] = value
    }

    await fs.writeFile(credPath, JSON.stringify(data, null, 2), {
      mode: 0o600, // Owner read/write only
    })
  }
}
