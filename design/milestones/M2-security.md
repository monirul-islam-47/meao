# Milestone 2: Security Primitives

**Status:** COMPLETE
**Scope:** MVP
**Dependencies:** M0 (Repo Setup)
**PR:** PR3

---

## Goal

Build shared security modules used by tools, memory, and audit. These are the foundational primitives that make the security contracts enforceable.

**Spec References:** [SECRET_DETECTION.md](../SECRET_DETECTION.md), [LABELS.md](../LABELS.md)

---

## File Structure

```
src/security/
├── index.ts                   # Public exports
├── secrets/
│   ├── index.ts
│   ├── types.ts               # SecretFinding, Confidence
│   ├── patterns.ts            # DEFINITE/PROBABLE/POSSIBLE patterns
│   ├── detector.ts            # SecretDetector class
│   └── context.ts             # Context-aware false positive reduction
├── labels/
│   ├── index.ts
│   ├── types.ts               # TrustLevel, DataClass, ContentLabel
│   ├── propagation.ts         # combineLabels(), taint rules
│   └── output.ts              # labelOutput() for tools
└── flow/
    ├── index.ts
    └── control.ts             # canEgress(), canWriteMemory()
```

---

## Key Exports

```typescript
// src/security/index.ts
// Export SINGLETON instance, not class (consistent usage everywhere)
export { secretDetector, type SecretFinding, type Confidence } from './secrets'
export {
  type TrustLevel,
  type DataClass,
  type ContentLabel,
  combineLabels,
  labelOutput,
} from './labels'
export { canEgress, canWriteSemanticMemory } from './flow'
```

---

## Implementation Requirements

### 1. Secret Detector

#### Types (secrets/types.ts)

```typescript
export type Confidence = 'definite' | 'probable' | 'possible'

export interface SecretFinding {
  type: string           // 'aws_key', 'jwt', 'private_key', etc.
  confidence: Confidence
  line: number
  column: number
  length: number
  context: string        // Surrounding context (redacted)
}

export interface SecretSummary {
  definite: number
  probable: number
  possible: number
  types: string[]
}

export interface PatternDefinition {
  name: string
  pattern: RegExp
  confidence: Confidence
  validator?: (match: string, context: string) => boolean
}
```

#### Patterns (secrets/patterns.ts)

```typescript
import { PatternDefinition } from './types'

// DEFINITE: Structure alone proves it's a secret
export const DEFINITE_PATTERNS: PatternDefinition[] = [
  {
    name: 'aws_access_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    confidence: 'definite',
  },
  {
    name: 'aws_secret_key',
    pattern: /(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/g,
    confidence: 'definite',
    validator: (match, context) => {
      // Must be near AWS-related keywords
      return /aws|secret|key/i.test(context)
    },
  },
  {
    name: 'github_token',
    pattern: /ghp_[A-Za-z0-9]{36}/g,
    confidence: 'definite',
  },
  {
    name: 'github_oauth',
    pattern: /gho_[A-Za-z0-9]{36}/g,
    confidence: 'definite',
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    confidence: 'definite',
  },
  {
    name: 'anthropic_key',
    pattern: /sk-ant-[A-Za-z0-9-_]{32,}/g,
    confidence: 'definite',
  },
  {
    name: 'openai_key',
    pattern: /sk-[A-Za-z0-9]{48}/g,
    confidence: 'definite',
  },
  {
    name: 'slack_token',
    pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
    confidence: 'definite',
  },
]

// PROBABLE: High confidence but needs context
export const PROBABLE_PATTERNS: PatternDefinition[] = [
  {
    name: 'generic_api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/gi,
    confidence: 'probable',
  },
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/g,
    confidence: 'probable',
  },
  {
    name: 'basic_auth',
    pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/g,
    confidence: 'probable',
  },
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    confidence: 'probable',
  },
]

// POSSIBLE: May be secret, context-dependent
export const POSSIBLE_PATTERNS: PatternDefinition[] = [
  {
    name: 'password_assignment',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{8,})['"]?/gi,
    confidence: 'possible',
  },
  {
    name: 'connection_string',
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/gi,
    confidence: 'possible',
  },
  {
    name: 'high_entropy_hex',
    pattern: /[a-f0-9]{32,}/gi,
    confidence: 'possible',
    validator: (match) => {
      // Check entropy
      return calculateEntropy(match) > 3.5
    },
  },
]

function calculateEntropy(str: string): number {
  const freq = new Map<string, number>()
  for (const char of str) {
    freq.set(char, (freq.get(char) || 0) + 1)
  }
  let entropy = 0
  for (const count of freq.values()) {
    const p = count / str.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}
```

#### Detector (secrets/detector.ts)

```typescript
import {
  SecretFinding,
  SecretSummary,
  PatternDefinition,
} from './types'
import {
  DEFINITE_PATTERNS,
  PROBABLE_PATTERNS,
  POSSIBLE_PATTERNS,
} from './patterns'

class SecretDetector {
  private patterns: PatternDefinition[]

  constructor() {
    this.patterns = [
      ...DEFINITE_PATTERNS,
      ...PROBABLE_PATTERNS,
      ...POSSIBLE_PATTERNS,
    ]
  }

  scan(text: string): SecretFinding[] {
    const findings: SecretFinding[] = []
    const lines = text.split('\n')

    for (const pattern of this.patterns) {
      // Reset regex state
      pattern.pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = pattern.pattern.exec(text)) !== null) {
        // Get line/column
        const beforeMatch = text.slice(0, match.index)
        const lineNumber = beforeMatch.split('\n').length
        const lastNewline = beforeMatch.lastIndexOf('\n')
        const column = match.index - lastNewline

        // Get context (surrounding text, redacted)
        const contextStart = Math.max(0, match.index - 20)
        const contextEnd = Math.min(text.length, match.index + match[0].length + 20)
        const context = text.slice(contextStart, contextEnd)

        // Run validator if present
        if (pattern.validator && !pattern.validator(match[0], context)) {
          continue
        }

        findings.push({
          type: pattern.name,
          confidence: pattern.confidence,
          line: lineNumber,
          column,
          length: match[0].length,
          context: this.redactContext(context, match[0]),
        })
      }
    }

    return this.deduplicateFindings(findings)
  }

  redact(text: string): { redacted: string; findings: SecretFinding[] } {
    const findings = this.scan(text)
    let redacted = text

    // Sort by position descending to preserve indices
    const sortedFindings = [...findings].sort(
      (a, b) => b.line - a.line || b.column - a.column
    )

    for (const finding of sortedFindings) {
      const lines = redacted.split('\n')
      const lineIndex = finding.line - 1
      const line = lines[lineIndex]

      if (line) {
        const before = line.slice(0, finding.column - 1)
        const after = line.slice(finding.column - 1 + finding.length)
        const replacement = `[REDACTED:${finding.type}]`
        lines[lineIndex] = before + replacement + after
        redacted = lines.join('\n')
      }
    }

    return { redacted, findings }
  }

  summarize(findings: SecretFinding[]): SecretSummary {
    const types = new Set<string>()
    let definite = 0
    let probable = 0
    let possible = 0

    for (const finding of findings) {
      types.add(finding.type)
      switch (finding.confidence) {
        case 'definite': definite++; break
        case 'probable': probable++; break
        case 'possible': possible++; break
      }
    }

    return {
      definite,
      probable,
      possible,
      types: Array.from(types),
    }
  }

  private redactContext(context: string, match: string): string {
    return context.replace(match, '[MATCH]')
  }

  private deduplicateFindings(findings: SecretFinding[]): SecretFinding[] {
    const seen = new Set<string>()
    return findings.filter(f => {
      const key = `${f.line}:${f.column}:${f.length}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}

// Export singleton instance
export const secretDetector = new SecretDetector()
```

### 2. Labels Engine

#### Types (labels/types.ts)

```typescript
export type TrustLevel = 'untrusted' | 'verified' | 'user' | 'system'
export type DataClass = 'public' | 'internal' | 'sensitive' | 'secret'

export interface ContentLabel {
  trustLevel: TrustLevel
  dataClass: DataClass
  source: {
    origin: string
    originId?: string
    timestamp: Date
  }
  inheritedFrom?: ContentLabel
}

// Trust level ordering (lowest to highest)
export const TRUST_ORDER: TrustLevel[] = ['untrusted', 'verified', 'user', 'system']

// Data class ordering (lowest to highest sensitivity)
export const DATA_CLASS_ORDER: DataClass[] = ['public', 'internal', 'sensitive', 'secret']
```

#### Propagation (labels/propagation.ts)

```typescript
import {
  ContentLabel,
  TrustLevel,
  DataClass,
  TRUST_ORDER,
  DATA_CLASS_ORDER,
} from './types'

// Get minimum trust level (lower is less trusted)
export function minTrust(a: TrustLevel, b: TrustLevel): TrustLevel {
  const aIndex = TRUST_ORDER.indexOf(a)
  const bIndex = TRUST_ORDER.indexOf(b)
  return aIndex <= bIndex ? a : b
}

// Get maximum sensitivity (higher is more sensitive)
export function maxSensitivity(a: DataClass, b: DataClass): DataClass {
  const aIndex = DATA_CLASS_ORDER.indexOf(a)
  const bIndex = DATA_CLASS_ORDER.indexOf(b)
  return aIndex >= bIndex ? a : b
}

// Taint propagation: lowest trust wins, highest sensitivity wins
export function combineLabels(a: ContentLabel, b: ContentLabel): ContentLabel {
  const trustLevel = minTrust(a.trustLevel, b.trustLevel)
  const dataClass = maxSensitivity(a.dataClass, b.dataClass)

  // Inherit from the more restrictive label
  const moreRestrictive =
    TRUST_ORDER.indexOf(a.trustLevel) <= TRUST_ORDER.indexOf(b.trustLevel) ? a : b

  return {
    trustLevel,
    dataClass,
    source: {
      origin: 'combined',
      timestamp: new Date(),
    },
    inheritedFrom: moreRestrictive,
  }
}
```

#### Output Labeling (labels/output.ts)

```typescript
import { ContentLabel, DataClass } from './types'
import { maxSensitivity } from './propagation'
import { SecretFinding } from '../secrets/types'

export interface ToolCapabilityLabels {
  outputTrust?: 'untrusted' | 'verified' | 'user'
  outputDataClass?: DataClass
  acceptsUntrusted?: boolean
}

export function labelOutput(
  capability: ToolCapabilityLabels | undefined,
  secretFindings: SecretFinding[]
): ContentLabel {
  let dataClass: DataClass = capability?.outputDataClass ?? 'internal'

  // Secrets elevate data class
  if (secretFindings.some(f => f.confidence === 'definite')) {
    dataClass = 'secret'
  } else if (secretFindings.some(f => f.confidence === 'probable')) {
    dataClass = maxSensitivity(dataClass, 'sensitive')
  }

  return {
    trustLevel: capability?.outputTrust ?? 'verified',
    dataClass,
    source: {
      origin: 'tool_output',
      timestamp: new Date(),
    },
  }
}
```

### 3. Flow Control

#### Flow Control (flow/control.ts)

```typescript
import { ContentLabel, TRUST_ORDER, DATA_CLASS_ORDER } from '../labels/types'

export interface FlowDecision {
  allowed: boolean
  reason?: string
  canOverride?: boolean  // User can confirm to bypass
}

// FC-1: Egress control
export function canEgress(label: ContentLabel, destination: string): FlowDecision {
  // Secret data NEVER egresses
  if (label.dataClass === 'secret') {
    return {
      allowed: false,
      reason: 'Secret data cannot egress',
      canOverride: false,
    }
  }

  // Sensitive data from untrusted sources cannot egress
  if (label.dataClass === 'sensitive' && label.trustLevel === 'untrusted') {
    return {
      allowed: false,
      reason: 'Untrusted sensitive data cannot egress',
      canOverride: true,
    }
  }

  return { allowed: true }
}

// FC-2: Semantic memory write control
export function canWriteSemanticMemory(label: ContentLabel): FlowDecision {
  // Untrusted content cannot write to semantic memory directly
  if (label.trustLevel === 'untrusted') {
    return {
      allowed: false,
      reason: 'Untrusted content cannot write to semantic memory without confirmation',
      canOverride: true,  // User can confirm
    }
  }

  return { allowed: true }
}

// FC-3: Tool input validation
export function canAcceptInput(
  toolAcceptsUntrusted: boolean,
  inputLabel: ContentLabel
): FlowDecision {
  if (!toolAcceptsUntrusted && inputLabel.trustLevel === 'untrusted') {
    return {
      allowed: false,
      reason: 'Tool does not accept untrusted input',
      canOverride: false,
    }
  }

  return { allowed: true }
}
```

---

## Tests

```
test/security/
├── secrets/
│   ├── patterns.test.ts       # Pattern matching
│   ├── detector.test.ts       # Scan + redact
│   └── false_positives.test.ts # Context-aware reduction
├── labels/
│   ├── propagation.test.ts    # combineLabels()
│   └── output.test.ts         # labelOutput()
└── flow/
    └── control.test.ts        # canEgress(), canWriteSemanticMemory()
```

### Critical Test Cases

```typescript
// test/security/secrets/detector.test.ts
describe('secretDetector', () => {
  it('detects AWS access keys with definite confidence', () => {
    const text = 'aws_key = AKIAIOSFODNN7EXAMPLE'
    const findings = secretDetector.scan(text)
    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('aws_access_key')
    expect(findings[0].confidence).toBe('definite')
  })

  it('detects GitHub tokens', () => {
    const text = 'token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    const findings = secretDetector.scan(text)
    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('github_token')
  })

  it('detects private keys', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...'
    const findings = secretDetector.scan(text)
    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('private_key')
  })

  it('detects Anthropic API keys', () => {
    const text = 'ANTHROPIC_API_KEY=sk-ant-api03-xxxx'
    const findings = secretDetector.scan(text)
    expect(findings.some(f => f.type === 'anthropic_key')).toBe(true)
  })

  it('redacts secrets while preserving structure', () => {
    const text = 'API_KEY=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nOTHER=value'
    const { redacted, findings } = secretDetector.redact(text)
    expect(redacted).toContain('[REDACTED:github_token]')
    expect(redacted).toContain('OTHER=value')
    expect(findings).toHaveLength(1)
  })

  it('reduces false positives for UUIDs', () => {
    const text = 'id: 550e8400-e29b-41d4-a716-446655440000'
    const findings = secretDetector.scan(text)
    // UUIDs should not be flagged as secrets
    expect(findings).toHaveLength(0)
  })
})

// test/security/labels/propagation.test.ts
describe('combineLabels', () => {
  it('uses lowest trust level', () => {
    const a: ContentLabel = {
      trustLevel: 'user',
      dataClass: 'public',
      source: { origin: 'a', timestamp: new Date() },
    }
    const b: ContentLabel = {
      trustLevel: 'untrusted',
      dataClass: 'public',
      source: { origin: 'b', timestamp: new Date() },
    }

    const combined = combineLabels(a, b)
    expect(combined.trustLevel).toBe('untrusted')
  })

  it('uses highest sensitivity', () => {
    const a: ContentLabel = {
      trustLevel: 'user',
      dataClass: 'public',
      source: { origin: 'a', timestamp: new Date() },
    }
    const b: ContentLabel = {
      trustLevel: 'user',
      dataClass: 'sensitive',
      source: { origin: 'b', timestamp: new Date() },
    }

    const combined = combineLabels(a, b)
    expect(combined.dataClass).toBe('sensitive')
  })

  it('tracks inheritance', () => {
    const a: ContentLabel = {
      trustLevel: 'untrusted',
      dataClass: 'public',
      source: { origin: 'a', timestamp: new Date() },
    }
    const b: ContentLabel = {
      trustLevel: 'user',
      dataClass: 'public',
      source: { origin: 'b', timestamp: new Date() },
    }

    const combined = combineLabels(a, b)
    expect(combined.inheritedFrom).toBe(a)  // More restrictive
  })
})

// test/security/flow/control.test.ts
describe('canEgress', () => {
  it('blocks secret data', () => {
    const label: ContentLabel = {
      trustLevel: 'user',
      dataClass: 'secret',
      source: { origin: 'test', timestamp: new Date() },
    }

    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe(false)
    expect(result.canOverride).toBe(false)
  })

  it('blocks untrusted sensitive data', () => {
    const label: ContentLabel = {
      trustLevel: 'untrusted',
      dataClass: 'sensitive',
      source: { origin: 'test', timestamp: new Date() },
    }

    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe(false)
    expect(result.canOverride).toBe(true)
  })

  it('allows trusted internal data', () => {
    const label: ContentLabel = {
      trustLevel: 'user',
      dataClass: 'internal',
      source: { origin: 'test', timestamp: new Date() },
    }

    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe(true)
  })
})
```

---

## Definition of Done

- [ ] secretDetector singleton exported and working
- [ ] All DEFINITE patterns detect real secrets
- [ ] False positives reduced for common cases (UUIDs, base64 images)
- [ ] `combineLabels()` follows "lowest trust, highest sensitivity" rule
- [ ] `labelOutput()` elevates data class based on secret findings
- [ ] Flow control functions enforce LABELS.md rules
- [ ] All tests pass with good coverage
- [ ] `pnpm check` passes

---

## PR Checklist

```markdown
## PR3: Security Primitives

### Changes
- [ ] Implement SecretDetector with pattern tiers
- [ ] Export secretDetector singleton
- [ ] Implement labels system (types, propagation, output)
- [ ] Implement flow control (canEgress, canWriteSemanticMemory)

### Tests
- [ ] Secret pattern detection tests
- [ ] False positive reduction tests
- [ ] Label propagation tests
- [ ] Flow control tests

### Verification
- [ ] secretDetector.scan() finds known secret formats
- [ ] combineLabels() propagates correctly
- [ ] `pnpm check` passes
```

---

## Next Milestone

After completing M2, proceed to [M3: Audit (Full)](./M3-audit-full.md).

---

*Last updated: 2026-01-29*
