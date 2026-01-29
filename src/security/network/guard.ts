import type { NetworkCheckResult, NetworkConfig, ToolNetworkPolicy } from './types.js'
import { DEFAULT_NETWORK_CONFIG } from './types.js'
import { DnsResolver } from './dns.js'
import { findAllowlistRule, isMethodAllowed } from './allowlist.js'

/**
 * Cloud metadata endpoint patterns (SSRF targets).
 */
const METADATA_ENDPOINTS = [
  '169.254.169.254', // AWS, GCP, Azure
  '100.100.100.200', // Alibaba Cloud
  'metadata.google.internal',
  'metadata.internal',
]

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
   *
   * @param url - URL to check
   * @param method - HTTP method
   * @param toolPolicy - Optional tool-specific network policy to enforce
   */
  async checkUrl(
    url: string,
    method: string = 'GET',
    toolPolicy?: ToolNetworkPolicy
  ): Promise<NetworkCheckResult> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` }
    }

    const hostname = parsed.hostname
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80)

    // 1. Check global allowlist (host + method)
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

    // 2. Enforce tool-specific policy (intersection with global)
    if (toolPolicy) {
      const toolCheck = this.checkToolPolicy(hostname, port, toolPolicy)
      if (!toolCheck.allowed) {
        return toolCheck
      }
    }

    // 3. Check blocked ports (tool policy)
    if (toolPolicy?.blockedPorts?.includes(port)) {
      return { allowed: false, reason: `Port ${port} is blocked by tool policy` }
    }

    // 4. Block metadata endpoints (tool policy or global)
    const blockMetadata = toolPolicy?.blockMetadataEndpoints ?? false
    if (blockMetadata && this.isMetadataEndpoint(hostname)) {
      return { allowed: false, reason: 'Cloud metadata endpoint blocked' }
    }

    // 5. DNS validation (prevent rebinding attacks)
    const dnsResult = await this.dnsResolver.resolve(hostname)
    if (!dnsResult.safe) {
      return { allowed: false, reason: dnsResult.reason }
    }

    // 6. Block private IPs (global config or tool policy)
    const blockPrivate = toolPolicy?.blockPrivateIPs ?? this.config.blockPrivateIps
    if (blockPrivate && dnsResult.ip) {
      if (this.isPrivateIp(dnsResult.ip)) {
        return { allowed: false, reason: 'Private IP not allowed' }
      }
    }

    // 7. Check resolved IP against metadata endpoints
    if (blockMetadata && dnsResult.ip && METADATA_ENDPOINTS.includes(dnsResult.ip)) {
      return { allowed: false, reason: 'Resolved IP is a metadata endpoint' }
    }

    return { allowed: true, resolvedIp: dnsResult.ip }
  }

  /**
   * Check tool-specific network policy.
   */
  private checkToolPolicy(
    hostname: string,
    port: number,
    policy: ToolNetworkPolicy
  ): NetworkCheckResult {
    if (policy.mode === 'allowlist') {
      // In allowlist mode, host must be in allowedHosts
      if (policy.allowedHosts && policy.allowedHosts.length > 0) {
        const allowed = policy.allowedHosts.some((pattern) => this.matchHost(hostname, pattern))
        if (!allowed) {
          return { allowed: false, reason: `Host ${hostname} not in tool allowlist` }
        }
      }
    } else if (policy.mode === 'blocklist') {
      // In blocklist mode, host must NOT be in blockedHosts
      if (policy.blockedHosts && policy.blockedHosts.length > 0) {
        const blocked = policy.blockedHosts.some((pattern) => this.matchHost(hostname, pattern))
        if (blocked) {
          return { allowed: false, reason: `Host ${hostname} is blocked by tool policy` }
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Check if a hostname matches a pattern (supports wildcards).
   */
  private matchHost(hostname: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // e.g., '.github.com'
      return hostname.endsWith(suffix) || hostname === pattern.slice(2)
    }
    return hostname === pattern
  }

  /**
   * Check if a hostname is a cloud metadata endpoint.
   */
  private isMetadataEndpoint(hostname: string): boolean {
    return METADATA_ENDPOINTS.some((endpoint) =>
      hostname === endpoint || hostname.endsWith(`.${endpoint}`)
    )
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
