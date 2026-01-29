import { lookup } from 'dns/promises'
import type { DnsValidationResult } from './types.js'

/**
 * DNS cache entry.
 */
interface DnsCacheEntry {
  ip: string
  expiresAt: number
}

/**
 * DNS resolver with caching and rebinding protection.
 */
export class DnsResolver {
  private cache = new Map<string, DnsCacheEntry>()
  private ttlMs: number

  constructor(ttlMs: number = 60000) {
    this.ttlMs = ttlMs
  }

  /**
   * Resolve a hostname and validate the result.
   */
  async resolve(hostname: string): Promise<DnsValidationResult> {
    // Check cache first
    const cached = this.cache.get(hostname)
    if (cached && cached.expiresAt > Date.now()) {
      return { safe: true, ip: cached.ip }
    }

    try {
      const result = await lookup(hostname, { all: false })
      const ip = result.address

      // Check for DNS rebinding (IP changed from cached)
      if (cached && cached.ip !== ip) {
        return {
          safe: false,
          reason: `DNS rebinding detected: ${hostname} changed from ${cached.ip} to ${ip}`,
        }
      }

      // Cache the result
      this.cache.set(hostname, {
        ip,
        expiresAt: Date.now() + this.ttlMs,
      })

      return { safe: true, ip }
    } catch (error) {
      return {
        safe: false,
        reason: `DNS resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }

  /**
   * Clear the DNS cache.
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Remove expired entries from cache.
   */
  pruneCache(): void {
    const now = Date.now()
    for (const [hostname, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(hostname)
      }
    }
  }
}
