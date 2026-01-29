import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RateLimiter } from '../../../src/channel/telegram/rate-limit.js'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = new RateLimiter({
      messagesPerMinute: 5,
      messagesPerHour: 10,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('check', () => {
    it('allows messages within per-minute limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('user-1')).toBe(true)
      }
    })

    it('blocks messages over per-minute limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.check('user-1')
      }
      expect(limiter.check('user-1')).toBe(false)
    })

    it('blocks messages over per-hour limit', () => {
      // Send 5 messages (hits minute limit)
      for (let i = 0; i < 5; i++) {
        limiter.check('user-1')
      }
      expect(limiter.check('user-1')).toBe(false)

      // Wait for minute reset
      vi.advanceTimersByTime(61_000)

      // Send 5 more (now at 10 total for the hour)
      for (let i = 0; i < 5; i++) {
        limiter.check('user-1')
      }

      // Wait for minute reset again
      vi.advanceTimersByTime(61_000)

      // Should be blocked by hour limit (10 messages already)
      expect(limiter.check('user-1')).toBe(false)
    })

    it('resets minute bucket after 60 seconds', () => {
      for (let i = 0; i < 5; i++) {
        limiter.check('user-1')
      }
      expect(limiter.check('user-1')).toBe(false)

      vi.advanceTimersByTime(61_000) // 61 seconds
      expect(limiter.check('user-1')).toBe(true)
    })

    it('resets hour bucket after 1 hour', () => {
      // Hit the hour limit (10 messages across multiple minutes)
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 5; j++) {
          limiter.check('user-1')
        }
        vi.advanceTimersByTime(61_000)
      }

      // Now blocked by hour limit
      expect(limiter.check('user-1')).toBe(false)

      // Advance past hour reset
      vi.advanceTimersByTime(3600_000)
      expect(limiter.check('user-1')).toBe(true)
    })

    it('maintains independent limits per user', () => {
      // User 1 hits their limit
      for (let i = 0; i < 5; i++) {
        limiter.check('user-1')
      }
      expect(limiter.check('user-1')).toBe(false)

      // User 2 should still be allowed
      expect(limiter.check('user-2')).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears rate limit state for a user', () => {
      // Hit the limit
      for (let i = 0; i < 5; i++) {
        limiter.check('user-1')
      }
      expect(limiter.check('user-1')).toBe(false)

      // Reset
      limiter.reset('user-1')

      // Should be allowed again
      expect(limiter.check('user-1')).toBe(true)
    })
  })

  describe('getStatus', () => {
    it('returns null for unknown user', () => {
      expect(limiter.getStatus('unknown')).toBeNull()
    })

    it('returns current limit status', () => {
      limiter.check('user-1')
      limiter.check('user-1')

      const status = limiter.getStatus('user-1')
      expect(status).not.toBeNull()
      expect(status?.minuteCount).toBe(2)
      expect(status?.hourCount).toBe(2)
    })
  })
})
