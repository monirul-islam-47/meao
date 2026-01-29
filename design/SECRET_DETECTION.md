# Secret Detection Module

**Status:** ACTIVE
**Version:** 1.0
**Last Updated:** 2026-01-29

This document specifies the **single shared secret detection module** used across all meao components: memory writes, tool output sanitization, logging redaction, and egress control.

---

## Design Principles

```
┌─────────────────────────────────────────────────────────────────────┐
│                   SECRET DETECTION PRINCIPLES                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. ONE MODULE, MANY CONSUMERS                                      │
│     Memory, tools, logging, egress all use SecretDetector           │
│                                                                      │
│  2. TIERED CONFIDENCE                                               │
│     definite → always redact                                        │
│     probable → redact + warn                                        │
│     possible → warn only (reduce false positives)                   │
│                                                                      │
│  3. CONTEXT-AWARE                                                   │
│     Entropy checks gated by context keywords                        │
│     Reduces false positives on legitimate base64                   │
│                                                                      │
│  4. EXTENSIBLE                                                      │
│     Users can add custom patterns                                   │
│     New services can be added without core changes                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Module Interface

```typescript
// The single secret detection module
class SecretDetector {
  // Detection
  static detect(content: string): SecretDetectionResult
  static hasDefiniteSecret(content: string): boolean
  static hasProbableSecret(content: string): boolean
  static hasPossibleSecret(content: string): boolean

  // Redaction
  static redact(content: string, options?: RedactOptions): string

  // Configuration
  static addPattern(pattern: SecretPattern): void
  static setOptions(options: SecretDetectorOptions): void
}

interface SecretDetectionResult {
  hasSecrets: boolean
  confidence: 'none' | 'possible' | 'probable' | 'definite'

  findings: SecretFinding[]

  // Summary counts
  definiteCount: number
  probableCount: number
  possibleCount: number
}

interface SecretFinding {
  confidence: 'definite' | 'probable' | 'possible'
  type: string              // 'api_key', 'private_key', 'password', etc.
  service?: string          // 'openai', 'anthropic', 'aws', etc.
  location: {
    start: number
    end: number
  }
  // NOTE: Never include the actual secret value in findings
}
```

---

## Pattern Registry

### Definite Secrets (Always Redact)

These patterns have extremely low false positive rates:

```typescript
const DEFINITE_PATTERNS: SecretPattern[] = [
  // Private Keys
  {
    name: 'private_key_pem',
    type: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    name: 'pgp_private_key',
    type: 'private_key',
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
  },

  // OpenAI
  {
    name: 'openai_api_key',
    type: 'api_key',
    service: 'openai',
    pattern: /sk-[A-Za-z0-9]{48}/g,
  },
  {
    name: 'openai_project_key',
    type: 'api_key',
    service: 'openai',
    pattern: /sk-proj-[A-Za-z0-9]{48}/g,
  },

  // Anthropic
  {
    name: 'anthropic_api_key',
    type: 'api_key',
    service: 'anthropic',
    pattern: /sk-ant-api[A-Za-z0-9-]{95}/g,
  },

  // AWS
  {
    name: 'aws_access_key',
    type: 'api_key',
    service: 'aws',
    pattern: /AKIA[A-Z0-9]{16}/g,
  },
  {
    name: 'aws_secret_key',
    type: 'api_key',
    service: 'aws',
    pattern: /(?<=aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+=]{40}/g,
  },

  // GitHub
  {
    name: 'github_pat',
    type: 'api_key',
    service: 'github',
    pattern: /ghp_[A-Za-z0-9]{36}/g,
  },
  {
    name: 'github_oauth',
    type: 'api_key',
    service: 'github',
    pattern: /gho_[A-Za-z0-9]{36}/g,
  },
  {
    name: 'github_fine_grained',
    type: 'api_key',
    service: 'github',
    pattern: /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/g,
  },

  // GitLab
  {
    name: 'gitlab_pat',
    type: 'api_key',
    service: 'gitlab',
    pattern: /glpat-[A-Za-z0-9\-]{20}/g,
  },

  // Stripe
  {
    name: 'stripe_secret_key',
    type: 'api_key',
    service: 'stripe',
    pattern: /sk_live_[A-Za-z0-9]{24}/g,
  },
  {
    name: 'stripe_restricted_key',
    type: 'api_key',
    service: 'stripe',
    pattern: /rk_live_[A-Za-z0-9]{24}/g,
  },

  // Slack
  {
    name: 'slack_bot_token',
    type: 'api_key',
    service: 'slack',
    pattern: /xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}/g,
  },
  {
    name: 'slack_webhook',
    type: 'webhook',
    service: 'slack',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
  },

  // Discord
  {
    name: 'discord_bot_token',
    type: 'api_key',
    service: 'discord',
    pattern: /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9-_]{6}\.[A-Za-z0-9-_]{27}/g,
  },
  {
    name: 'discord_webhook',
    type: 'webhook',
    service: 'discord',
    pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g,
  },

  // Telegram
  {
    name: 'telegram_bot_token',
    type: 'api_key',
    service: 'telegram',
    pattern: /[0-9]{8,10}:[A-Za-z0-9_-]{35}/g,
  },

  // Twilio
  {
    name: 'twilio_api_key',
    type: 'api_key',
    service: 'twilio',
    pattern: /SK[A-Za-z0-9]{32}/g,
  },

  // SendGrid
  {
    name: 'sendgrid_api_key',
    type: 'api_key',
    service: 'sendgrid',
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
  },

  // Mailchimp
  {
    name: 'mailchimp_api_key',
    type: 'api_key',
    service: 'mailchimp',
    pattern: /[a-f0-9]{32}-us\d{1,2}/g,
  },

  // Firebase
  {
    name: 'firebase_api_key',
    type: 'api_key',
    service: 'firebase',
    pattern: /AIza[A-Za-z0-9_-]{35}/g,
  },

  // Google Cloud
  {
    name: 'gcp_service_account',
    type: 'service_account',
    service: 'gcp',
    pattern: /"private_key":\s*"-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----"/g,
  },

  // Heroku
  {
    name: 'heroku_api_key',
    type: 'api_key',
    service: 'heroku',
    pattern: /[h|H]eroku.*[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g,
  },

  // npm
  {
    name: 'npm_token',
    type: 'api_key',
    service: 'npm',
    pattern: /npm_[A-Za-z0-9]{36}/g,
  },

  // PyPI
  {
    name: 'pypi_token',
    type: 'api_key',
    service: 'pypi',
    pattern: /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9-_]{50,}/g,
  },
]
```

### Probable Secrets (Redact + Warn)

High confidence but may have edge cases:

```typescript
const PROBABLE_PATTERNS: SecretPattern[] = [
  // Database URLs with embedded credentials
  {
    name: 'postgres_url',
    type: 'database_url',
    service: 'postgres',
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+/g,
  },
  {
    name: 'mongodb_url',
    type: 'database_url',
    service: 'mongodb',
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^/]+/g,
  },
  {
    name: 'redis_url',
    type: 'database_url',
    service: 'redis',
    pattern: /redis:\/\/:[^@]+@[^/]+/g,
  },
  {
    name: 'mysql_url',
    type: 'database_url',
    service: 'mysql',
    pattern: /mysql:\/\/[^:]+:[^@]+@[^/]+/g,
  },

  // Authorization headers
  {
    name: 'bearer_token',
    type: 'auth_header',
    pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/g,
  },
  {
    name: 'basic_auth',
    type: 'auth_header',
    pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/g,
  },

  // Password assignments (various formats)
  {
    name: 'password_assignment',
    type: 'password',
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi,
  },
  {
    name: 'api_key_assignment',
    type: 'api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?[^\s'"]{16,}['"]?/gi,
  },
  {
    name: 'secret_assignment',
    type: 'secret',
    pattern: /(?:secret|token)\s*[=:]\s*['"]?[^\s'"]{16,}['"]?/gi,
  },

  // JWT tokens (3 base64 segments)
  {
    name: 'jwt_token',
    type: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
  },

  // SSH keys (public, but often sensitive)
  {
    name: 'ssh_public_key',
    type: 'ssh_key',
    pattern: /ssh-(?:rsa|dss|ed25519|ecdsa)\s+AAAA[A-Za-z0-9+/=]+/g,
  },
]
```

### Possible Secrets (Warn Only)

Context-dependent, high false positive potential:

```typescript
const POSSIBLE_PATTERNS: SecretPattern[] = [
  // Long base64 - only flag if near secret keywords
  {
    name: 'long_base64_contextual',
    type: 'encoded_blob',
    pattern: null,  // Uses custom detection
    customDetector: (content: string): SecretFinding[] => {
      const findings: SecretFinding[] = []
      const contextKeywords = /(?:key|secret|token|password|credential|auth)/i

      // Find long base64 strings
      const base64Pattern = /[A-Za-z0-9+/=]{64,}/g
      let match
      while ((match = base64Pattern.exec(content)) !== null) {
        // Check surrounding context (50 chars before)
        const start = Math.max(0, match.index - 50)
        const context = content.slice(start, match.index)

        if (contextKeywords.test(context)) {
          findings.push({
            confidence: 'possible',
            type: 'encoded_blob',
            location: { start: match.index, end: match.index + match[0].length }
          })
        }
      }
      return findings
    },
  },

  // Hex strings that might be secrets
  {
    name: 'long_hex_contextual',
    type: 'encoded_blob',
    pattern: null,
    customDetector: (content: string): SecretFinding[] => {
      const findings: SecretFinding[] = []
      const contextKeywords = /(?:key|secret|hash|digest|salt)/i

      const hexPattern = /[0-9a-f]{40,}/gi
      let match
      while ((match = hexPattern.exec(content)) !== null) {
        const start = Math.max(0, match.index - 50)
        const context = content.slice(start, match.index)

        if (contextKeywords.test(context)) {
          findings.push({
            confidence: 'possible',
            type: 'encoded_blob',
            location: { start: match.index, end: match.index + match[0].length }
          })
        }
      }
      return findings
    },
  },
]
```

---

## Detection Algorithm

```typescript
function detect(content: string): SecretDetectionResult {
  const findings: SecretFinding[] = []

  // Check definite patterns
  for (const pattern of DEFINITE_PATTERNS) {
    const matches = content.matchAll(pattern.pattern)
    for (const match of matches) {
      findings.push({
        confidence: 'definite',
        type: pattern.type,
        service: pattern.service,
        location: { start: match.index!, end: match.index! + match[0].length }
      })
    }
  }

  // Check probable patterns
  for (const pattern of PROBABLE_PATTERNS) {
    const matches = content.matchAll(pattern.pattern)
    for (const match of matches) {
      // Skip if already covered by definite
      if (isLocationCovered(findings, match.index!)) continue

      findings.push({
        confidence: 'probable',
        type: pattern.type,
        service: pattern.service,
        location: { start: match.index!, end: match.index! + match[0].length }
      })
    }
  }

  // Check possible patterns (custom detectors)
  for (const pattern of POSSIBLE_PATTERNS) {
    if (pattern.customDetector) {
      const customFindings = pattern.customDetector(content)
      for (const finding of customFindings) {
        if (!isLocationCovered(findings, finding.location.start)) {
          findings.push(finding)
        }
      }
    }
  }

  // Sort by location
  findings.sort((a, b) => a.location.start - b.location.start)

  // Calculate summary
  const definiteCount = findings.filter(f => f.confidence === 'definite').length
  const probableCount = findings.filter(f => f.confidence === 'probable').length
  const possibleCount = findings.filter(f => f.confidence === 'possible').length

  return {
    hasSecrets: findings.length > 0,
    confidence: definiteCount > 0 ? 'definite'
              : probableCount > 0 ? 'probable'
              : possibleCount > 0 ? 'possible'
              : 'none',
    findings,
    definiteCount,
    probableCount,
    possibleCount,
  }
}
```

---

## Redaction

```typescript
interface RedactOptions {
  replacement?: string                    // Default: '[REDACTED]'
  preserveType?: boolean                  // Show type like '[REDACTED:api_key]'
  minConfidence?: 'definite' | 'probable' | 'possible'  // Default: 'probable'
}

function redact(content: string, options: RedactOptions = {}): string {
  const {
    replacement = '[REDACTED]',
    preserveType = true,
    minConfidence = 'probable',
  } = options

  const detection = detect(content)

  // Filter by minimum confidence
  const confidenceOrder = ['possible', 'probable', 'definite']
  const minIndex = confidenceOrder.indexOf(minConfidence)
  const toRedact = detection.findings.filter(f =>
    confidenceOrder.indexOf(f.confidence) >= minIndex
  )

  // Redact in reverse order to preserve positions
  let result = content
  for (const finding of toRedact.reverse()) {
    const replacementText = preserveType
      ? `[REDACTED:${finding.type}${finding.service ? `:${finding.service}` : ''}]`
      : replacement

    result =
      result.slice(0, finding.location.start) +
      replacementText +
      result.slice(finding.location.end)
  }

  return result
}
```

---

## Consumer Integration

### Memory Module

```typescript
// In memory/write.ts
import { SecretDetector } from '@meao/secret-detection'

async function writeMemory(entry: MemoryEntry): Promise<void> {
  const detection = SecretDetector.detect(entry.content)

  if (detection.definiteCount > 0) {
    // Always redact definite secrets
    entry.content = SecretDetector.redact(entry.content, { minConfidence: 'definite' })
    await audit.log({ action: 'secret_redacted', ... })
  }

  if (detection.probableCount > 0) {
    // Redact probable and log
    entry.content = SecretDetector.redact(entry.content, { minConfidence: 'probable' })
  }

  // Possible secrets: just warn, don't redact (to avoid false positives)
  if (detection.possibleCount > 0 && detection.definiteCount === 0 && detection.probableCount === 0) {
    await notifyUser('Content may contain secrets. Review before proceeding.')
  }

  await db.memory.insert(entry)
}
```

### Tool Output Sanitization

```typescript
// In tools/executor.ts
import { SecretDetector } from '@meao/secret-detection'

function sanitizeToolOutput(output: string, tool: ToolPlugin): string {
  if (!tool.capability.data.sanitizeOutput) {
    return output
  }

  // Redact at probable level for tool outputs
  return SecretDetector.redact(output, {
    minConfidence: 'probable',
    preserveType: true,
  })
}
```

### Logging Redaction

```typescript
// In platform/logger.ts
import { SecretDetector } from '@meao/secret-detection'

function redactForLog(data: unknown): unknown {
  if (typeof data === 'string') {
    // For logs, redact even possible secrets (safety first)
    return SecretDetector.redact(data, {
      minConfidence: 'possible',
      preserveType: false,  // Just [REDACTED]
    })
  }

  if (typeof data === 'object' && data !== null) {
    // Recursively redact object values
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      // Skip known sensitive keys entirely
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = redactForLog(value)
      }
    }
    return result
  }

  return data
}

const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pwd',
  'secret', 'token', 'key',
  'apikey', 'api_key',
  'authorization', 'auth',
  'credential', 'credentials',
  'private', 'privatekey', 'private_key',
])
```

### Egress Control

```typescript
// In network/guard.ts
import { SecretDetector } from '@meao/secret-detection'

async function validateEgressContent(content: string): Promise<void> {
  const detection = SecretDetector.detect(content)

  if (detection.definiteCount > 0) {
    throw new SecurityError('Cannot send content containing secrets externally')
  }

  if (detection.probableCount > 0) {
    // Require explicit approval
    const approved = await requestApproval(
      'Content may contain secrets. Send anyway?',
      { showRedacted: SecretDetector.redact(content) }
    )
    if (!approved) {
      throw new UserCancelledError('User declined to send probable secrets')
    }
  }
}
```

---

## Custom Pattern Configuration

Users can add patterns in config:

```json
{
  "secretDetection": {
    "additionalPatterns": [
      {
        "name": "internal_api_key",
        "type": "api_key",
        "service": "internal",
        "confidence": "definite",
        "pattern": "INTERNAL_[A-Z0-9]{32}"
      }
    ],
    "disabledPatterns": [
      "ssh_public_key"
    ],
    "redactionOptions": {
      "preserveType": true,
      "minConfidence": "probable"
    }
  }
}
```

---

## Testing

The module must have comprehensive tests:

```typescript
describe('SecretDetector', () => {
  describe('definite patterns', () => {
    it('detects OpenAI API keys', () => {
      const result = SecretDetector.detect('key = sk-abcdefghijklmnopqrstuvwxyz012345678901234567')
      expect(result.definiteCount).toBe(1)
      expect(result.findings[0].service).toBe('openai')
    })

    // ... test each definite pattern
  })

  describe('probable patterns', () => {
    it('detects postgres URLs', () => {
      const result = SecretDetector.detect('DATABASE_URL=postgres://user:pass@localhost/db')
      expect(result.probableCount).toBe(1)
    })

    // ... test each probable pattern
  })

  describe('possible patterns', () => {
    it('only flags base64 with context keywords', () => {
      // Without context - should not flag
      const noContext = SecretDetector.detect('data: ' + 'a'.repeat(100))
      expect(noContext.possibleCount).toBe(0)

      // With context - should flag
      const withContext = SecretDetector.detect('secret: ' + 'a'.repeat(100))
      expect(withContext.possibleCount).toBe(1)
    })
  })

  describe('redaction', () => {
    it('preserves non-secret content', () => {
      const input = 'Hello, world! The answer is 42.'
      expect(SecretDetector.redact(input)).toBe(input)
    })

    it('redacts definite secrets', () => {
      const input = 'key: sk-abcdefghijklmnopqrstuvwxyz012345678901234567'
      const redacted = SecretDetector.redact(input)
      expect(redacted).toBe('key: [REDACTED:api_key:openai]')
    })
  })

  describe('false positive reduction', () => {
    it('does not flag git commit hashes', () => {
      const result = SecretDetector.detect('commit abc123def456789...')
      expect(result.hasSecrets).toBe(false)
    })

    it('does not flag base64 images', () => {
      const result = SecretDetector.detect('data:image/png;base64,iVBORw0KGgo...')
      expect(result.hasSecrets).toBe(false)
    })
  })
})
```

---

## Pattern Maintenance Policy

Secret patterns change over time as services update their key formats.

### Update Process

```
1. DETECTION
   • CI tests fail on new key format
   • User reports false negative
   • Security advisory mentions new format

2. ASSESSMENT
   • Verify pattern accuracy
   • Test for false positives
   • Determine confidence tier

3. IMPLEMENTATION
   • Add pattern to appropriate tier
   • Add test fixtures (positive + negative)
   • Bump registry version

4. RELEASE
   • Include in release notes
   • Document any breaking changes
   • Update this spec
```

### Version Tracking

```typescript
const PATTERN_REGISTRY_VERSION = '1.0.0'

// Bump on pattern changes:
// MAJOR: Breaking changes (pattern removals, confidence changes)
// MINOR: New patterns added
// PATCH: Pattern fixes (fewer false positives)
```

---

## Engine Compatibility

### Node.js Requirements

**Minimum: Node.js 18+**

Some regex constructs used:
- Named capture groups (Node 10+)
- Lookbehinds (Node 8.10+)
- Unicode property escapes (Node 10+)
- `matchAll()` (Node 12+)
- `replaceAll()` (Node 15+)

```typescript
// Compatibility check on module load
const NODE_MAJOR = parseInt(process.versions.node.split('.')[0])
if (NODE_MAJOR < 18) {
  throw new Error('SecretDetector requires Node.js 18 or later')
}
```

### Performance Considerations

```typescript
// Patterns are compiled ONCE at module load
const COMPILED_PATTERNS = DEFINITE_PATTERNS.map(p => ({
  ...p,
  compiled: new RegExp(p.pattern.source, p.pattern.flags)
}))

// Detection can be streamed/chunked for large outputs
async function* detectStreaming(
  stream: AsyncIterable<string>,
  chunkSize: number = 64 * 1024
): AsyncGenerator<SecretFinding> {
  let buffer = ''

  for await (const chunk of stream) {
    buffer += chunk

    // Process complete chunks
    while (buffer.length >= chunkSize * 2) {
      const toProcess = buffer.slice(0, chunkSize)
      buffer = buffer.slice(chunkSize / 2)  // Overlap to catch boundary secrets

      const result = detect(toProcess)
      for (const finding of result.findings) {
        yield finding
      }
    }
  }

  // Process remaining buffer
  if (buffer.length > 0) {
    const result = detect(buffer)
    for (const finding of result.findings) {
      yield finding
    }
  }
}

// For bash output (can be very large)
const MAX_SYNC_SIZE = 1024 * 1024  // 1MB
function detectWithSizeCheck(content: string): SecretDetectionResult {
  if (content.length > MAX_SYNC_SIZE) {
    console.warn('Large content, consider streaming detection')
  }
  return detect(content)
}
```

---

## CI Test Matrix

### Required Test Coverage

```yaml
# .github/workflows/secret-detection.yml
name: Secret Detection Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}

      - run: npm ci
      - run: npm run test:secret-detection

  regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run test:secret-detection:regression
```

### Regression Fixtures

```
tests/fixtures/secrets/
├── definite/
│   ├── openai-api-key.txt          # sk-abc...
│   ├── anthropic-api-key.txt       # sk-ant-api...
│   ├── aws-access-key.txt          # AKIA...
│   ├── github-pat.txt              # ghp_...
│   ├── private-key-rsa.txt         # -----BEGIN RSA PRIVATE KEY-----
│   └── ...
├── probable/
│   ├── postgres-url.txt            # postgres://user:pass@host/db
│   ├── bearer-token.txt            # Bearer eyJ...
│   ├── password-assignment.txt     # password = "secret123"
│   └── ...
├── possible/
│   ├── base64-with-context.txt     # secret: aGVsbG8gd29ybGQ=...
│   └── hex-with-context.txt        # key: 0123456789abcdef...
├── false-positives/
│   ├── git-commit-hash.txt         # Should NOT trigger
│   ├── base64-image.txt            # data:image/png;base64,...
│   ├── uuid.txt                    # 550e8400-e29b-41d4-a716-446655440000
│   ├── lorem-ipsum.txt             # Random text, no secrets
│   └── code-examples.txt           # Example code with placeholder keys
└── edge-cases/
    ├── boundary-match.txt          # Secret at chunk boundary
    ├── overlapping-patterns.txt    # Multiple patterns match
    └── unicode-content.txt         # UTF-8 content with secrets
```

### Test Assertions

```typescript
describe('SecretDetector Regression', () => {
  const fixtures = loadFixtures('tests/fixtures/secrets')

  describe('definite secrets', () => {
    for (const [name, content] of fixtures.definite) {
      it(`detects ${name}`, () => {
        const result = SecretDetector.detect(content)
        expect(result.definiteCount).toBeGreaterThan(0)
      })
    }
  })

  describe('false positives', () => {
    for (const [name, content] of fixtures.falsePositives) {
      it(`does not flag ${name}`, () => {
        const result = SecretDetector.detect(content)
        expect(result.definiteCount).toBe(0)
        expect(result.probableCount).toBe(0)
      })
    }
  })

  describe('redaction preserves structure', () => {
    it('maintains line count', () => {
      const input = 'line1\nkey=sk-abc123...\nline3'
      const redacted = SecretDetector.redact(input)
      expect(redacted.split('\n').length).toBe(input.split('\n').length)
    })
  })
})
```

---

*This specification is living documentation. Update as patterns evolve.*

*Last updated: 2026-01-29*
