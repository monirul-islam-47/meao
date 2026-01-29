/**
 * Tests for token management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  FileTokenStore,
  generateToken,
  generateOwnerToken,
} from '../../../src/gateway/auth/tokens.js'

describe('Token Management', () => {
  let testDir: string
  let store: FileTokenStore

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'meao-token-test-'))
    store = new FileTokenStore(testDir)
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('generateToken', () => {
    it('generates unique tokens', () => {
      const token1 = generateToken()
      const token2 = generateToken()

      expect(token1).not.toBe(token2)
      expect(token1.length).toBeGreaterThan(30)
    })

    it('generates URL-safe tokens', () => {
      const token = generateToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    })
  })

  describe('FileTokenStore', () => {
    describe('save and verify', () => {
      it('saves and retrieves token', async () => {
        const token = generateToken()

        await store.save(token, {
          userId: 'user1',
          deviceName: 'Test Device',
          role: 'user',
          createdAt: Date.now(),
        })

        const info = await store.verify(token)
        expect(info).not.toBeNull()
        expect(info?.userId).toBe('user1')
        expect(info?.deviceName).toBe('Test Device')
        expect(info?.role).toBe('user')
      })

      it('returns null for invalid token', async () => {
        const info = await store.verify('invalid-token')
        expect(info).toBeNull()
      })

      it('updates lastUsedAt on verify', async () => {
        const token = generateToken()
        const before = Date.now()

        await store.save(token, {
          userId: 'user1',
          deviceName: 'Test',
          role: 'user',
          createdAt: before,
        })

        await new Promise(r => setTimeout(r, 10))

        const info = await store.verify(token)
        expect(info?.lastUsedAt).toBeGreaterThan(before)
      })
    })

    describe('expiration', () => {
      it('rejects expired tokens', async () => {
        const token = generateToken()

        await store.save(token, {
          userId: 'user1',
          deviceName: 'Test',
          role: 'user',
          createdAt: Date.now(),
          expiresAt: Date.now() - 1000, // Already expired
        })

        const info = await store.verify(token)
        expect(info).toBeNull()
      })

      it('accepts non-expired tokens', async () => {
        const token = generateToken()

        await store.save(token, {
          userId: 'user1',
          deviceName: 'Test',
          role: 'user',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60000, // Expires in 1 minute
        })

        const info = await store.verify(token)
        expect(info).not.toBeNull()
      })
    })

    describe('revoke', () => {
      it('revokes a token', async () => {
        const token = generateToken()

        await store.save(token, {
          userId: 'user1',
          deviceName: 'Test',
          role: 'user',
          createdAt: Date.now(),
        })

        const info = await store.verify(token)
        expect(info).not.toBeNull()

        await store.revoke(info!.hash)

        const afterRevoke = await store.verify(token)
        expect(afterRevoke).toBeNull()
      })
    })

    describe('list', () => {
      it('lists all tokens', async () => {
        await store.save(generateToken(), {
          userId: 'user1',
          deviceName: 'Device 1',
          role: 'user',
          createdAt: Date.now(),
        })

        await store.save(generateToken(), {
          userId: 'user2',
          deviceName: 'Device 2',
          role: 'owner',
          createdAt: Date.now(),
        })

        const tokens = await store.list()
        expect(tokens).toHaveLength(2)
      })
    })

    describe('persistence', () => {
      it('persists tokens across store instances', async () => {
        const token = generateToken()

        await store.save(token, {
          userId: 'user1',
          deviceName: 'Test',
          role: 'user',
          createdAt: Date.now(),
        })

        // Create new store instance
        const newStore = new FileTokenStore(testDir)
        const info = await newStore.verify(token)

        expect(info).not.toBeNull()
        expect(info?.userId).toBe('user1')
      })
    })
  })

  describe('generateOwnerToken', () => {
    it('creates owner token', async () => {
      const token = await generateOwnerToken(store)

      expect(token).toBeDefined()
      expect(token.length).toBeGreaterThan(30)

      const info = await store.verify(token)
      expect(info?.role).toBe('owner')
      expect(info?.userId).toBe('owner')
    })
  })
})
