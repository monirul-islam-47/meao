/**
 * Result of a network check.
 */
export interface NetworkCheckResult {
  allowed: boolean
  reason?: string
  resolvedIp?: string
}

/**
 * DNS validation result.
 */
export interface DnsValidationResult {
  safe: boolean
  ip?: string
  reason?: string
}

/**
 * Allowlist rule for a host.
 */
export interface AllowlistRule {
  host: string
  methods?: string[]
  description?: string
}

/**
 * Network guard configuration.
 */
export interface NetworkConfig {
  allowlist: AllowlistRule[]
  blockPrivateIps: boolean
  dnsCache: {
    ttlMs: number
  }
}

/**
 * Default network configuration.
 */
export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  allowlist: [
    // Common safe hosts for GET requests
    { host: '*.github.com', methods: ['GET'], description: 'GitHub' },
    { host: '*.githubusercontent.com', methods: ['GET'], description: 'GitHub raw content' },
    { host: '*.npmjs.com', methods: ['GET'], description: 'npm registry' },
    { host: '*.npmjs.org', methods: ['GET'], description: 'npm registry' },
    { host: '*.pypi.org', methods: ['GET'], description: 'PyPI' },
    { host: '*.docs.rs', methods: ['GET'], description: 'Rust docs' },
    { host: '*.crates.io', methods: ['GET'], description: 'Rust crates' },
    { host: '*.pkg.go.dev', methods: ['GET'], description: 'Go packages' },
    { host: '*.stackoverflow.com', methods: ['GET'], description: 'Stack Overflow' },
    { host: '*.wikipedia.org', methods: ['GET'], description: 'Wikipedia' },
    { host: '*.mozilla.org', methods: ['GET'], description: 'MDN' },
  ],
  blockPrivateIps: true,
  dnsCache: {
    ttlMs: 60000, // 1 minute
  },
}
