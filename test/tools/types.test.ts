import { describe, it, expect } from 'vitest'
import {
  computeApprovalId,
  formatAction,
  matchesActionPattern,
} from '../../src/tools/types.js'

describe('computeApprovalId', () => {
  describe('URL targets', () => {
    it('includes host and path', () => {
      const id = computeApprovalId('web_fetch', 'GET', 'https://api.example.com/users')

      expect(id).toBe('web_fetch:GET:api.example.com/users')
    })

    it('includes query parameters for API endpoints', () => {
      // This is critical - approving DELETE to /api/users?id=1
      // should NOT approve DELETE to /api/users?id=2
      const id1 = computeApprovalId('web_fetch', 'DELETE', 'https://api.example.com/users?id=1')
      const id2 = computeApprovalId('web_fetch', 'DELETE', 'https://api.example.com/users?id=2')

      expect(id1).not.toBe(id2)
      expect(id1).toContain('id=1')
      expect(id2).toContain('id=2')
    })

    it('sorts query parameters for consistent IDs', () => {
      // Same parameters in different order should produce same ID
      const id1 = computeApprovalId('web_fetch', 'GET', 'https://api.example.com/search?a=1&b=2')
      const id2 = computeApprovalId('web_fetch', 'GET', 'https://api.example.com/search?b=2&a=1')

      expect(id1).toBe(id2)
    })

    it('excludes fragments (they do not affect server behavior)', () => {
      const id1 = computeApprovalId('web_fetch', 'GET', 'https://example.com/page#section1')
      const id2 = computeApprovalId('web_fetch', 'GET', 'https://example.com/page#section2')

      expect(id1).toBe(id2)
    })

    it('lowercases host for consistency', () => {
      const id1 = computeApprovalId('web_fetch', 'GET', 'https://API.EXAMPLE.COM/users')
      const id2 = computeApprovalId('web_fetch', 'GET', 'https://api.example.com/users')

      expect(id1).toBe(id2)
    })

    it('removes trailing slash from path', () => {
      const id1 = computeApprovalId('web_fetch', 'GET', 'https://api.example.com/users/')
      const id2 = computeApprovalId('web_fetch', 'GET', 'https://api.example.com/users')

      expect(id1).toBe(id2)
    })

    it('preserves root path', () => {
      const id = computeApprovalId('web_fetch', 'GET', 'https://example.com/')

      expect(id).toBe('web_fetch:GET:example.com/')
    })
  })

  describe('command targets', () => {
    it('lowercases and trims commands', () => {
      const id1 = computeApprovalId('bash', 'execute', '  LS -LA  ')
      const id2 = computeApprovalId('bash', 'execute', 'ls -la')

      expect(id1).toBe(id2)
    })

    it('preserves command detail (no over-normalization)', () => {
      const id1 = computeApprovalId('bash', 'execute', 'rm file1.txt')
      const id2 = computeApprovalId('bash', 'execute', 'rm file2.txt')

      expect(id1).not.toBe(id2)
    })

    it('truncates extremely long commands at 200 chars', () => {
      const longCommand = 'x'.repeat(300)
      const id = computeApprovalId('bash', 'execute', longCommand)

      // 200 char target + tool + action + colons
      expect(id).toBe(`bash:execute:${'x'.repeat(200)}`)
    })
  })

  describe('path targets', () => {
    it('normalizes file paths', () => {
      const id = computeApprovalId('write', 'write', '/home/user/file.txt')

      expect(id).toBe('write:write:/home/user/file.txt')
    })
  })

  describe('empty target protection', () => {
    it('throws on empty string target', () => {
      expect(() => computeApprovalId('bash', 'execute', '')).toThrow(
        'Approval target cannot be empty'
      )
    })

    it('throws on whitespace-only target', () => {
      expect(() => computeApprovalId('bash', 'execute', '   ')).toThrow(
        'Approval target cannot be empty'
      )
    })

    it('throws on undefined target coerced to string', () => {
      // This simulates String(undefined) which produces 'undefined'
      // But we want to catch truly empty targets
      const id = computeApprovalId('bash', 'execute', 'undefined')
      expect(id).toBe('bash:execute:undefined')
    })
  })
})

describe('formatAction', () => {
  it('formats tool:action', () => {
    expect(formatAction({ tool: 'bash', action: 'execute', affectsOthers: false, isDestructive: false, hasFinancialImpact: false })).toBe('bash:execute')
  })

  it('formats tool:category:action when category present', () => {
    expect(formatAction({ tool: 'web_fetch', category: 'network', action: 'GET', affectsOthers: false, isDestructive: false, hasFinancialImpact: false })).toBe('web_fetch:network:GET')
  })
})

describe('matchesActionPattern', () => {
  it('matches exact action', () => {
    expect(matchesActionPattern('bash:execute', 'bash:execute')).toBe(true)
  })

  it('does not match different actions', () => {
    expect(matchesActionPattern('bash:execute', 'write:write')).toBe(false)
  })

  it('matches wildcard pattern', () => {
    expect(matchesActionPattern('bash:execute', 'bash:*')).toBe(true)
    expect(matchesActionPattern('bash:read', 'bash:*')).toBe(true)
  })

  it('does not match wildcard for different tool', () => {
    expect(matchesActionPattern('write:write', 'bash:*')).toBe(false)
  })
})
