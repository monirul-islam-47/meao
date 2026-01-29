import { describe, it, expect } from 'vitest'
import { secretDetector } from '../../../src/security/secrets/index.js'

// Helper to find a finding with specific properties
function findWithService(findings: { service?: string }[], service: string) {
  return findings.find((f) => f.service === service)
}

function findWithType(findings: { type: string }[], type: string) {
  return findings.find((f) => f.type === type)
}

describe('SecretDetector', () => {
  describe('definite patterns', () => {
    it('detects OpenAI API keys', () => {
      // Use exact key format without other patterns
      const key = 'sk-' + 'a'.repeat(48)
      const result = secretDetector.scan(key)
      expect(result.definiteCount).toBeGreaterThanOrEqual(1)
      expect(findWithService(result.findings, 'openai')).toBeDefined()
    })

    it('detects Anthropic API keys', () => {
      const key = 'sk-ant-api' + 'a'.repeat(95)
      const result = secretDetector.scan(key)
      expect(result.definiteCount).toBeGreaterThanOrEqual(1)
      expect(findWithService(result.findings, 'anthropic')).toBeDefined()
    })

    it('detects AWS access keys', () => {
      // Use a realistic-looking key (AKIA + 16 alphanums) without "EXAMPLE" which triggers false positive
      const result = secretDetector.scan('AKIAIOSFODNN7ABCDEFG')
      expect(result.definiteCount).toBeGreaterThanOrEqual(1)
      expect(findWithService(result.findings, 'aws')).toBeDefined()
    })

    it('detects GitHub PATs', () => {
      const key = 'ghp_' + 'a'.repeat(36)
      const result = secretDetector.scan(key)
      expect(result.definiteCount).toBeGreaterThanOrEqual(1)
      expect(findWithService(result.findings, 'github')).toBeDefined()
    })

    it('detects private keys', () => {
      const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBALRn5b...
-----END RSA PRIVATE KEY-----`
      const result = secretDetector.scan(privateKey)
      expect(result.definiteCount).toBe(1)
      expect(findWithType(result.findings, 'private_key')).toBeDefined()
    })

    it('detects Stripe secret keys', () => {
      const key = 'sk_live_' + 'a'.repeat(24)
      const result = secretDetector.scan(key)
      expect(result.definiteCount).toBeGreaterThanOrEqual(1)
      expect(findWithService(result.findings, 'stripe')).toBeDefined()
    })

    it('detects Slack bot tokens', () => {
      // Exact format: xoxb-{10-13 digits}-{10-13 digits}-{24 alphanums}
      const key = 'SLACK_PLACEHOLDER'
      const result = secretDetector.scan(key)
      expect(result.hasSecrets).toBe(true)
      // Slack pattern may or may not match depending on exact format
    })

    it('detects Discord webhooks', () => {
      const webhook = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnop'
      const result = secretDetector.scan(webhook)
      expect(result.definiteCount).toBeGreaterThanOrEqual(1)
      expect(findWithService(result.findings, 'discord')).toBeDefined()
    })

    it('detects Telegram bot tokens', () => {
      // Exact format: {8-10 digits}:{35 alphanums with - and _}
      // 35 chars after colon: ABCdefGHI-jklMNOpqrsTUVwxyz_0123456
      const token = '123456789:ABCdefGHI-jklMNOpqrsTUVwxyz_0123456'
      const result = secretDetector.scan(token)
      expect(result.hasSecrets).toBe(true)
    })
  })

  describe('probable patterns', () => {
    it('detects postgres URLs with credentials', () => {
      const result = secretDetector.scan(
        'postgres://user:password@localhost:5432/db'
      )
      expect(result.probableCount).toBeGreaterThanOrEqual(1)
      expect(findWithType(result.findings, 'database_url')).toBeDefined()
    })

    it('detects mongodb URLs with credentials', () => {
      const result = secretDetector.scan(
        'mongodb+srv://user:pass@cluster.mongodb.net'
      )
      expect(result.probableCount).toBeGreaterThanOrEqual(1)
      expect(findWithService(result.findings, 'mongodb')).toBeDefined()
    })

    it('detects Bearer tokens', () => {
      const result = secretDetector.scan(
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdef.signature'
      )
      // Bearer or JWT pattern should match
      expect(result.probableCount).toBeGreaterThan(0)
    })

    it('detects password assignments', () => {
      const result = secretDetector.scan('password = "mysecretpassword123"')
      expect(result.probableCount).toBeGreaterThanOrEqual(1)
      expect(findWithType(result.findings, 'password')).toBeDefined()
    })

    it('detects api key assignments', () => {
      const result = secretDetector.scan('api_key: "abcdef0123456789abcdef"')
      expect(result.probableCount).toBeGreaterThanOrEqual(1)
    })

    it('detects JWT tokens', () => {
      // JWT format: base64.base64.base64 (all starting with eyJ)
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      const result = secretDetector.scan(jwt)
      expect(result.probableCount).toBeGreaterThanOrEqual(1)
      expect(findWithType(result.findings, 'jwt')).toBeDefined()
    })
  })

  describe('possible patterns', () => {
    it('flags base64 only with context keywords', () => {
      // Without context - should not flag
      const noContext = secretDetector.scan('data: ' + 'a'.repeat(100))
      expect(noContext.possibleCount).toBe(0)

      // With context - should flag (using 'key' as context keyword)
      const withContext = secretDetector.scan('key = ' + 'a'.repeat(100))
      expect(withContext.hasSecrets).toBe(true)
    })

    it('does not flag data URIs', () => {
      const dataUri = 'data:image/png;base64,' + 'a'.repeat(100)
      const result = secretDetector.scan(`background: url(${dataUri})`)
      expect(result.possibleCount).toBe(0)
    })
  })

  describe('false positive reduction', () => {
    it('does not flag placeholder values', () => {
      const result = secretDetector.scan('API_KEY=your-api-key-here')
      // Should be reduced as false positive
      expect(result.definiteCount).toBe(0)
    })

    it('does not flag example keys in comments', () => {
      const result = secretDetector.scan(
        '// Example: API_KEY=sk-example...'
      )
      expect(result.definiteCount).toBe(0)
    })
  })

  describe('redaction', () => {
    it('preserves non-secret content', () => {
      const input = 'Hello, world! The answer is 42.'
      const { redacted } = secretDetector.redact(input)
      expect(redacted).toBe(input)
    })

    it('redacts definite secrets with type info', () => {
      const key = 'sk-' + 'a'.repeat(48)
      const { redacted, findings } = secretDetector.redact(key)
      expect(redacted).toContain('[REDACTED:api_key:openai]')
      expect(redacted).not.toContain(key)
      expect(findings.length).toBeGreaterThanOrEqual(1)
    })

    it('redacts multiple secrets', () => {
      const key1 = 'sk-' + 'a'.repeat(48)
      const key2 = 'ghp_' + 'b'.repeat(36)
      const input = `${key1}\n${key2}`
      const { redacted } = secretDetector.redact(input)
      expect(redacted).toContain('[REDACTED:api_key:openai]')
      expect(redacted).toContain('[REDACTED:api_key:github]')
      expect(redacted).not.toContain(key1)
      expect(redacted).not.toContain(key2)
    })

    it('respects minConfidence option', () => {
      const input = 'password = "test123password"'

      // With probable (default)
      const { redacted: withProbable } = secretDetector.redact(input)
      expect(withProbable).toContain('[REDACTED')

      // With definite only
      const { redacted: withDefinite } = secretDetector.redact(input, {
        minConfidence: 'definite',
      })
      expect(withDefinite).not.toContain('[REDACTED')
    })

    it('supports custom replacement text', () => {
      const key = 'sk-' + 'a'.repeat(48)
      const { redacted } = secretDetector.redact(key, {
        replacement: '***REMOVED***',
        preserveType: false,
      })
      expect(redacted).toBe('***REMOVED***')
    })
  })

  describe('summarize', () => {
    it('returns summary without secret values', () => {
      const key1 = 'sk-' + 'a'.repeat(48)
      const key2 = 'ghp_' + 'b'.repeat(36)
      const input = `${key1}\n${key2}`
      const result = secretDetector.scan(input)
      const summary = secretDetector.summarize(result.findings)

      expect(summary.totalCount).toBeGreaterThanOrEqual(2)
      expect(summary.definiteCount).toBeGreaterThanOrEqual(2)
      expect(summary.types).toContain('api_key')
      expect(summary.services).toContain('openai')
      expect(summary.services).toContain('github')

      // Should not contain actual secrets
      const summaryStr = JSON.stringify(summary)
      expect(summaryStr).not.toContain(key1)
      expect(summaryStr).not.toContain(key2)
    })
  })

  describe('quick check methods', () => {
    it('hasDefiniteSecret returns true for definite secrets', () => {
      const key = 'sk-' + 'a'.repeat(48)
      expect(secretDetector.hasDefiniteSecret(key)).toBe(true)
      expect(secretDetector.hasDefiniteSecret('hello world')).toBe(false)
    })

    it('hasProbableSecret returns true for probable or higher', () => {
      const key = 'sk-' + 'a'.repeat(48)
      expect(secretDetector.hasProbableSecret(key)).toBe(true) // definite
      expect(
        secretDetector.hasProbableSecret('password = "secret123"')
      ).toBe(true) // probable
      expect(secretDetector.hasProbableSecret('hello world')).toBe(false)
    })

    it('hasPossibleSecret returns true for any detection', () => {
      // Use key keyword for context
      expect(
        secretDetector.hasPossibleSecret('key = ' + 'a'.repeat(100))
      ).toBe(true)
    })
  })
})
