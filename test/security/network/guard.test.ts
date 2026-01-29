import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ToolNetworkPolicy } from '../../../src/security/network/types.js'

// Mock module - use a shared object to allow test-time configuration
const mockDns = {
  resolve: vi.fn().mockResolvedValue({ safe: true, ip: '93.184.216.34' }),
  clearCache: vi.fn(),
}

vi.mock('../../../src/security/network/dns.js', () => ({
  DnsResolver: class MockDnsResolver {
    resolve(...args: any[]) { return mockDns.resolve(...args) }
    clearCache() { return mockDns.clearCache() }
  },
}))

// Import after mock is set up
import { NetworkGuard } from '../../../src/security/network/guard.js'

describe('NetworkGuard', () => {
  let guard: NetworkGuard

  beforeEach(() => {
    mockDns.resolve.mockReset()
    mockDns.resolve.mockResolvedValue({ safe: true, ip: '93.184.216.34' })

    guard = new NetworkGuard({
      allowlist: [
        { host: '*.github.com', methods: ['GET'] },
        { host: 'example.com', methods: ['GET', 'POST'] },
        { host: '*.evil.com', methods: ['GET'] },
      ],
      blockPrivateIps: true,
      dnsCache: { ttlMs: 60000 },
    })
  })

  describe('checkUrl with tool policy', () => {
    it('allows URL when tool policy allows the host', async () => {
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'allowlist',
        allowedHosts: ['example.com'],
      }

      const result = await guard.checkUrl('https://example.com/api', 'GET', toolPolicy)
      expect(result.allowed).toBe(true)
    })

    it('blocks URL when tool allowlist does not include host', async () => {
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'allowlist',
        allowedHosts: ['other.com'],
      }

      const result = await guard.checkUrl('https://example.com/api', 'GET', toolPolicy)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('not in tool allowlist')
    })

    it('blocks URL when tool blocklist includes host', async () => {
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'blocklist',
        blockedHosts: ['*.evil.com'],
      }

      const result = await guard.checkUrl('https://api.evil.com/data', 'GET', toolPolicy)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('blocked by tool policy')
    })

    it('allows URL when tool blocklist does not include host', async () => {
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'blocklist',
        blockedHosts: ['*.other.com'],
      }

      const result = await guard.checkUrl('https://example.com/api', 'GET', toolPolicy)
      expect(result.allowed).toBe(true)
    })

    it('blocks URL on blocked port', async () => {
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'allowlist',
        allowedHosts: ['example.com'],
        blockedPorts: [8080],
      }

      const result = await guard.checkUrl('https://example.com:8080/api', 'GET', toolPolicy)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Port 8080 is blocked')
    })

    it('blocks metadata endpoints when configured', async () => {
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'allowlist',
        allowedHosts: ['169.254.169.254'],
        blockMetadataEndpoints: true,
      }

      // Need to add the metadata IP to global allowlist for this test
      guard.addAllowlistRule({ host: '169.254.169.254', methods: ['GET'] })

      const result = await guard.checkUrl('http://169.254.169.254/latest/meta-data', 'GET', toolPolicy)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('metadata endpoint')
    })

    it('respects tool policy for private IP blocking', async () => {
      // Create guard that doesn't block private IPs globally
      const permissiveGuard = new NetworkGuard({
        allowlist: [{ host: 'localhost', methods: ['GET'] }],
        blockPrivateIps: false,
        dnsCache: { ttlMs: 60000 },
      })

      // But tool policy blocks them
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'allowlist',
        allowedHosts: ['localhost'],
        blockPrivateIPs: true,
      }

      // Mock resolver to return localhost IP
      mockDns.resolve.mockResolvedValueOnce({ safe: true, ip: '127.0.0.1' })

      const result = await permissiveGuard.checkUrl('http://localhost/api', 'GET', toolPolicy)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Private IP')
    })

    it('enforces intersection of global and tool policies', async () => {
      // Host is in global allowlist but not in tool allowlist
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'allowlist',
        allowedHosts: ['other.com'],
      }

      // Even though github.com is in global allowlist, tool policy restricts it
      const result = await guard.checkUrl('https://api.github.com/repos', 'GET', toolPolicy)
      expect(result.allowed).toBe(false)
    })

    it('supports wildcard patterns in tool allowlist', async () => {
      const toolPolicy: ToolNetworkPolicy = {
        mode: 'allowlist',
        allowedHosts: ['*.github.com'],
      }

      const result = await guard.checkUrl('https://api.github.com/repos', 'GET', toolPolicy)
      expect(result.allowed).toBe(true)
    })
  })

  describe('checkUrl without tool policy (backward compatibility)', () => {
    it('still works without tool policy', async () => {
      const result = await guard.checkUrl('https://api.github.com/repos', 'GET')
      expect(result.allowed).toBe(true)
    })

    it('blocks hosts not in global allowlist', async () => {
      const result = await guard.checkUrl('https://unknown.com/api', 'GET')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('not in allowlist')
    })
  })
})
