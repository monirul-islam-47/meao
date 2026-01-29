import type { NetworkCheckResult, NetworkConfig } from './types.js'
import { DEFAULT_NETWORK_CONFIG } from './types.js'
import { DnsResolver } from './dns.js'
import { findAllowlistRule, isMethodAllowed } from './allowlist.js'

/**
 * NetworkGuard - SINGLE CHOKE POINT for all network egress.
 *
 * ALL network egress MUST go through NetworkGuard. This is an architectural invariant.
 *
 * Usage:
 *   import { networkGuard } from './network'
 *   const result = await networkGuard.checkUrl(url, 'GET')
 */
class NetworkGuard {
  private config: NetworkConfig
  private dnsResolver: DnsResolver

  constructor(config: NetworkConfig = DEFAULT_NETWORK_CONFIG) {
    this.config = config
    this.dnsResolver = new DnsResolver(config.dnsCache.ttlMs)
  }

  /**
   * Check if a URL is allowed for network egress.
   * Called by: web_fetch tool, any future network tools.
   */
  async checkUrl(url: string, method: string = 'GET'): Promise<NetworkCheckResult> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` }
    }

    const hostname = parsed.hostname

    // 1. Check allowlist (host + method)
    const rule = findAllowlistRule(hostname, this.config.allowlist)
    if (!rule) {
      return {
        allowed: false,
        reason: `Host not in allowlist: ${hostname}`,
      }
    }

    if (!isMethodAllowed(method, rule)) {
      return {
        allowed: false,
        reason: `Method ${method} not allowed for host: ${hostname}`,
      }
    }

    // 2. DNS validation (prevent rebinding attacks)
    const dnsResult = await this.dnsResolver.resolve(hostname)
    if (!dnsResult.safe) {
      return { allowed: false, reason: dnsResult.reason }
    }

    // 3. Block private IPs if configured
    if (this.config.blockPrivateIps && dnsResult.ip) {
      if (this.isPrivateIp(dnsResult.ip)) {
        return { allowed: false, reason: 'Private IP not allowed' }
      }
    }

    return { allowed: true, resolvedIp: dnsResult.ip }
  }

  /**
   * Check if an IP address is private/internal.
   *
   * Blocks:
   * - IPv4: loopback, private ranges, link-local, metadata
   * - IPv6: loopback, ULA, link-local
   */
  private isPrivateIp(ip: string): boolean {
    // IPv4 checks
    if (this.isIPv4(ip)) {
      return this.isPrivateIPv4(ip)
    }

    // IPv6 checks
    return this.isPrivateIPv6(ip)
  }

  private isIPv4(ip: string): boolean {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
  }

  private isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some((p) => isNaN(p))) {
      return true // Invalid = treat as private
    }

    const [a, b] = parts

    // Loopback: 127.0.0.0/8
    if (a === 127) return true

    // Private: 10.0.0.0/8
    if (a === 10) return true

    // Private: 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true

    // Private: 192.168.0.0/16
    if (a === 192 && b === 168) return true

    // Link-local: 169.254.0.0/16
    if (a === 169 && b === 254) return true

    // Cloud metadata: 169.254.169.254 (already covered) and 100.100.100.200 (Alibaba)
    // Metadata endpoint commonly at 169.254.169.254

    // Broadcast
    if (a === 255) return true

    // Current network
    if (a === 0) return true

    return false
  }

  private isPrivateIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase()

    // Loopback: ::1
    if (normalized === '::1') return true

    // Unspecified: ::
    if (normalized === '::') return true

    // Link-local: fe80::/10
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
        normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true
    }

    // Unique local address (ULA): fc00::/7 (fc00::-fdff::)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true
    }

    // IPv4-mapped IPv6: ::ffff:x.x.x.x
    const ipv4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (ipv4MappedMatch) {
      return this.isPrivateIPv4(ipv4MappedMatch[1])
    }

    return false
  }

  /**
   * Update the allowlist.
   */
  updateAllowlist(allowlist: NetworkConfig['allowlist']): void {
    this.config.allowlist = allowlist
  }

  /**
   * Add a rule to the allowlist.
   */
  addAllowlistRule(rule: NetworkConfig['allowlist'][0]): void {
    this.config.allowlist.push(rule)
  }

  /**
   * Clear the DNS cache.
   */
  clearDnsCache(): void {
    this.dnsResolver.clearCache()
  }
}

// Export singleton instance
export const networkGuard = new NetworkGuard()

// Export class for testing
export { NetworkGuard }
