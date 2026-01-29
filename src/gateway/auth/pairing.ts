/**
 * Device pairing flow for gateway authentication
 */

import { randomBytes } from 'crypto'
import { generateToken, type TokenStore } from './tokens.js'

/**
 * Pending pairing code
 */
interface PairingCode {
  code: string
  deviceName: string
  expiresAt: number
  createdAt: number
}

/**
 * Pairing result
 */
export interface PairingResult {
  success: boolean
  token?: string
  error?: string
}

/**
 * Device pairing manager
 */
export class DevicePairing {
  private pendingCodes = new Map<string, PairingCode>()
  private tokenStore: TokenStore
  private codeExpiryMs: number

  constructor(tokenStore: TokenStore, options?: { codeExpiryMs?: number }) {
    this.tokenStore = tokenStore
    this.codeExpiryMs = options?.codeExpiryMs ?? 5 * 60 * 1000 // 5 minutes default
  }

  /**
   * Generate a 6-character pairing code.
   * Display this on the new device, user enters it on the owner device.
   */
  generateCode(deviceName: string): string {
    // Clean up expired codes
    this.cleanupExpired()

    // Generate 6-character alphanumeric code (uppercase for readability)
    const code = randomBytes(3)
      .toString('hex')
      .toUpperCase()
      .slice(0, 6)

    const now = Date.now()
    this.pendingCodes.set(code, {
      code,
      deviceName,
      createdAt: now,
      expiresAt: now + this.codeExpiryMs,
    })

    return code
  }

  /**
   * Verify a pairing code and issue a token.
   * Called by the owner device to approve the pairing.
   */
  async verifyCode(code: string, role: 'owner' | 'user' = 'user'): Promise<PairingResult> {
    const normalizedCode = code.toUpperCase().trim()
    const pending = this.pendingCodes.get(normalizedCode)

    if (!pending) {
      return { success: false, error: 'Invalid pairing code' }
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingCodes.delete(normalizedCode)
      return { success: false, error: 'Pairing code expired' }
    }

    // Code is valid - generate token
    this.pendingCodes.delete(normalizedCode)

    const token = generateToken()
    const userId = `device-${randomBytes(4).toString('hex')}`

    await this.tokenStore.save(token, {
      userId,
      deviceName: pending.deviceName,
      role,
      createdAt: Date.now(),
    })

    return { success: true, token }
  }

  /**
   * Get pending code info (for display).
   */
  getCodeInfo(code: string): { deviceName: string; expiresIn: number } | null {
    const pending = this.pendingCodes.get(code.toUpperCase().trim())
    if (!pending) return null

    const expiresIn = Math.max(0, pending.expiresAt - Date.now())
    return { deviceName: pending.deviceName, expiresIn }
  }

  /**
   * Cancel a pending pairing.
   */
  cancelCode(code: string): boolean {
    return this.pendingCodes.delete(code.toUpperCase().trim())
  }

  /**
   * Get count of pending codes (for rate limiting).
   */
  getPendingCount(): number {
    this.cleanupExpired()
    return this.pendingCodes.size
  }

  /**
   * Clean up expired codes.
   */
  private cleanupExpired(): void {
    const now = Date.now()
    for (const [code, pending] of this.pendingCodes) {
      if (now > pending.expiresAt) {
        this.pendingCodes.delete(code)
      }
    }
  }
}
