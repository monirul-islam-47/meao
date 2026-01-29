/**
 * Per-user rate limiting for Telegram channel.
 *
 * Tracks message counts per user with minute and hour buckets.
 * Buckets reset automatically after their time window expires.
 */

export interface RateLimitConfig {
  messagesPerMinute: number
  messagesPerHour: number
}

interface UserLimit {
  minuteCount: number
  minuteResetAt: number
  hourCount: number
  hourResetAt: number
}

/**
 * Rate limiter with sliding window buckets.
 */
export class RateLimiter {
  private config: RateLimitConfig
  private limits = new Map<string, UserLimit>()

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  /**
   * Check if user can send a message and increment counters.
   *
   * @param userId - User identifier
   * @returns true if allowed, false if rate limited
   */
  check(userId: string): boolean {
    const now = Date.now()
    let limit = this.limits.get(userId)

    // Initialize new user
    if (!limit) {
      limit = {
        minuteCount: 0,
        minuteResetAt: now + 60_000,
        hourCount: 0,
        hourResetAt: now + 3600_000,
      }
      this.limits.set(userId, limit)
    }

    // Reset minute bucket if expired
    if (now >= limit.minuteResetAt) {
      limit.minuteCount = 0
      limit.minuteResetAt = now + 60_000
    }

    // Reset hour bucket if expired
    if (now >= limit.hourResetAt) {
      limit.hourCount = 0
      limit.hourResetAt = now + 3600_000
    }

    // Check limits
    if (limit.minuteCount >= this.config.messagesPerMinute) {
      return false
    }
    if (limit.hourCount >= this.config.messagesPerHour) {
      return false
    }

    // Increment counters
    limit.minuteCount++
    limit.hourCount++
    return true
  }

  /**
   * Reset rate limit for a user.
   *
   * @param userId - User identifier
   */
  reset(userId: string): void {
    this.limits.delete(userId)
  }

  /**
   * Get current limit status for a user.
   *
   * @param userId - User identifier
   * @returns Current counts and reset times, or null if no history
   */
  getStatus(userId: string): UserLimit | null {
    return this.limits.get(userId) ?? null
  }
}
