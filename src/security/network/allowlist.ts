import type { AllowlistRule } from './types.js'

/**
 * Check if a hostname matches an allowlist pattern.
 *
 * Patterns:
 * - Exact match: 'example.com'
 * - Wildcard subdomain: '*.example.com' (matches sub.example.com and example.com)
 */
export function matchHost(hostname: string, pattern: string): boolean {
  // Normalize to lowercase
  const host = hostname.toLowerCase()
  const pat = pattern.toLowerCase()

  // Exact match
  if (host === pat) {
    return true
  }

  // Wildcard subdomain match
  if (pat.startsWith('*.')) {
    const suffix = pat.slice(1) // '.example.com'
    const base = pat.slice(2) // 'example.com'

    // Match subdomain
    if (host.endsWith(suffix)) {
      return true
    }

    // Also match base domain (e.g., '*.example.com' matches 'example.com')
    if (host === base) {
      return true
    }
  }

  return false
}

/**
 * Find the allowlist rule that matches a hostname.
 */
export function findAllowlistRule(
  hostname: string,
  allowlist: AllowlistRule[]
): AllowlistRule | undefined {
  return allowlist.find((rule) => matchHost(hostname, rule.host))
}

/**
 * Check if a method is allowed for a host.
 */
export function isMethodAllowed(
  method: string,
  rule: AllowlistRule
): boolean {
  const normalizedMethod = method.toUpperCase()

  // GET is always allowed if host matches
  if (normalizedMethod === 'GET') {
    return true
  }

  // Non-GET requires explicit permission
  if (!rule.methods) {
    return false
  }

  return rule.methods.map((m) => m.toUpperCase()).includes(normalizedMethod)
}
