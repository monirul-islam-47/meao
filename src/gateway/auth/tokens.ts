/**
 * Token management for gateway authentication
 */

import { randomBytes, createHash } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

/**
 * Token metadata
 */
export interface TokenInfo {
  /** Token hash (stored, not the raw token) */
  hash: string
  /** User/device ID */
  userId: string
  /** Device name for display */
  deviceName: string
  /** Role (owner has full access) */
  role: 'owner' | 'user'
  /** Creation timestamp */
  createdAt: number
  /** Last used timestamp */
  lastUsedAt?: number
  /** Expiration timestamp (optional) */
  expiresAt?: number
}

/**
 * Token store interface
 */
export interface TokenStore {
  save(token: string, info: Omit<TokenInfo, 'hash'>): Promise<void>
  verify(token: string): Promise<TokenInfo | null>
  revoke(tokenHash: string): Promise<void>
  list(): Promise<TokenInfo[]>
}

/**
 * Hash a token for storage (never store raw tokens)
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * File-based token store
 */
export class FileTokenStore implements TokenStore {
  private baseDir: string
  private tokens: Map<string, TokenInfo> = new Map()
  private loaded = false

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private getPath(): string {
    return join(this.baseDir, 'tokens.json')
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    await mkdir(this.baseDir, { recursive: true })

    try {
      const content = await readFile(this.getPath(), 'utf-8')
      const data = JSON.parse(content) as TokenInfo[]
      this.tokens = new Map(data.map(t => [t.hash, t]))
    } catch {
      // File doesn't exist yet
      this.tokens = new Map()
    }

    this.loaded = true
  }

  private async persist(): Promise<void> {
    const data = Array.from(this.tokens.values())
    await writeFile(this.getPath(), JSON.stringify(data, null, 2))
  }

  async save(token: string, info: Omit<TokenInfo, 'hash'>): Promise<void> {
    await this.ensureLoaded()

    const hash = hashToken(token)
    const tokenInfo: TokenInfo = { ...info, hash }

    this.tokens.set(hash, tokenInfo)
    await this.persist()
  }

  async verify(token: string): Promise<TokenInfo | null> {
    await this.ensureLoaded()

    const hash = hashToken(token)
    const info = this.tokens.get(hash)

    if (!info) return null

    // Check expiration
    if (info.expiresAt && Date.now() > info.expiresAt) {
      await this.revoke(hash)
      return null
    }

    // Update last used
    info.lastUsedAt = Date.now()
    await this.persist()

    return info
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.ensureLoaded()
    this.tokens.delete(tokenHash)
    await this.persist()
  }

  async list(): Promise<TokenInfo[]> {
    await this.ensureLoaded()
    return Array.from(this.tokens.values())
  }
}

/**
 * Generate a secure random token
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Generate the owner token (first-time setup)
 */
export async function generateOwnerToken(store: TokenStore): Promise<string> {
  const token = generateToken()

  await store.save(token, {
    userId: 'owner',
    deviceName: 'CLI',
    role: 'owner',
    createdAt: Date.now(),
  })

  return token
}
