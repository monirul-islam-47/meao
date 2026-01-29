/**
 * Tests for device pairing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { DevicePairing } from '../../../src/gateway/auth/pairing.js'
import { FileTokenStore } from '../../../src/gateway/auth/tokens.js'

describe('DevicePairing', () => {
  let testDir: string
  let tokenStore: FileTokenStore
  let pairing: DevicePairing

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'meao-pairing-test-'))
    tokenStore = new FileTokenStore(testDir)
    pairing = new DevicePairing(tokenStore)
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('generateCode', () => {
    it('generates 6-character code', () => {
      const code = pairing.generateCode('Test Device')
      expect(code).toMatch(/^[A-Z0-9]{6}$/)
    })

    it('generates unique codes', () => {
      const code1 = pairing.generateCode('Device 1')
      const code2 = pairing.generateCode('Device 2')
      expect(code1).not.toBe(code2)
    })
  })

  describe('verifyCode', () => {
    it('verifies valid code and returns token', async () => {
      const code = pairing.generateCode('My Phone')

      const result = await pairing.verifyCode(code)

      expect(result.success).toBe(true)
      expect(result.token).toBeDefined()
      expect(result.token!.length).toBeGreaterThan(30)
    })

    it('rejects invalid code', async () => {
      const result = await pairing.verifyCode('INVALID')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid pairing code')
    })

    it('rejects expired code', async () => {
      // Create pairing with 100ms expiry
      const fastPairing = new DevicePairing(tokenStore, { codeExpiryMs: 100 })
      const code = fastPairing.generateCode('Device')

      // Wait for expiration
      await new Promise(r => setTimeout(r, 150))

      const result = await fastPairing.verifyCode(code)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Pairing code expired')
    })

    it('consumes code after use', async () => {
      const code = pairing.generateCode('Device')

      await pairing.verifyCode(code)
      const secondTry = await pairing.verifyCode(code)

      expect(secondTry.success).toBe(false)
    })

    it('normalizes code case', async () => {
      const code = pairing.generateCode('Device')

      const result = await pairing.verifyCode(code.toLowerCase())

      expect(result.success).toBe(true)
    })

    it('creates token with correct role', async () => {
      const code = pairing.generateCode('Device')

      await pairing.verifyCode(code, 'user')

      const tokens = await tokenStore.list()
      expect(tokens).toHaveLength(1)
      expect(tokens[0].role).toBe('user')
    })
  })

  describe('getCodeInfo', () => {
    it('returns code info', () => {
      const code = pairing.generateCode('My Device')

      const info = pairing.getCodeInfo(code)

      expect(info).not.toBeNull()
      expect(info?.deviceName).toBe('My Device')
      expect(info?.expiresIn).toBeGreaterThan(0)
    })

    it('returns null for unknown code', () => {
      const info = pairing.getCodeInfo('UNKNOWN')
      expect(info).toBeNull()
    })
  })

  describe('cancelCode', () => {
    it('cancels pending code', () => {
      const code = pairing.generateCode('Device')

      const cancelled = pairing.cancelCode(code)

      expect(cancelled).toBe(true)
      expect(pairing.getCodeInfo(code)).toBeNull()
    })

    it('returns false for unknown code', () => {
      const cancelled = pairing.cancelCode('UNKNOWN')
      expect(cancelled).toBe(false)
    })
  })

  describe('getPendingCount', () => {
    it('counts pending codes', () => {
      expect(pairing.getPendingCount()).toBe(0)

      pairing.generateCode('Device 1')
      expect(pairing.getPendingCount()).toBe(1)

      pairing.generateCode('Device 2')
      expect(pairing.getPendingCount()).toBe(2)
    })

    it('excludes expired codes', async () => {
      const fastPairing = new DevicePairing(tokenStore, { codeExpiryMs: 50 })

      fastPairing.generateCode('Device')
      expect(fastPairing.getPendingCount()).toBe(1)

      await new Promise(r => setTimeout(r, 100))

      expect(fastPairing.getPendingCount()).toBe(0)
    })
  })

  describe('timeout behavior', () => {
    it('times out with fake timers', async () => {
      vi.useFakeTimers()

      const fastPairing = new DevicePairing(tokenStore, { codeExpiryMs: 5 * 60 * 1000 })
      const code = fastPairing.generateCode('Device')

      // Fast forward 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000)

      const result = await fastPairing.verifyCode(code)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Pairing code expired')

      vi.useRealTimers()
    })
  })
})
