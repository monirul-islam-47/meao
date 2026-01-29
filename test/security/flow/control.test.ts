import { describe, it, expect } from 'vitest'
import {
  canEgress,
  canWriteSemanticMemory,
  canWriteWorkingMemory,
  canChainTools,
} from '../../../src/security/flow/control.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'

const makeLabel = (
  trustLevel: ContentLabel['trustLevel'],
  dataClass: ContentLabel['dataClass']
): ContentLabel => ({
  trustLevel,
  dataClass,
  source: { origin: 'test', timestamp: new Date() },
})

describe('canEgress', () => {
  it('blocks secret data', () => {
    const label = makeLabel('user', 'secret')
    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Secret')
  })

  it('blocks untrusted sensitive data', () => {
    const label = makeLabel('untrusted', 'sensitive')
    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe(false)
  })

  it('asks for user sensitive data', () => {
    const label = makeLabel('user', 'sensitive')
    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe('ask')
  })

  it('allows public data', () => {
    const label = makeLabel('user', 'public')
    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe(true)
  })

  it('allows internal user data', () => {
    const label = makeLabel('user', 'internal')
    const result = canEgress(label, 'https://example.com')
    expect(result.allowed).toBe(true)
  })
})

describe('canWriteSemanticMemory', () => {
  it('blocks untrusted content', () => {
    const label = makeLabel('untrusted', 'internal')
    const result = canWriteSemanticMemory(label)
    expect(result.allowed).toBe(false)
    expect(result.canOverride).toBe(true) // User can confirm
  })

  it('asks for verified content', () => {
    const label = makeLabel('verified', 'internal')
    const result = canWriteSemanticMemory(label)
    expect(result.allowed).toBe('ask')
  })

  it('allows user content', () => {
    const label = makeLabel('user', 'internal')
    const result = canWriteSemanticMemory(label)
    expect(result.allowed).toBe(true)
  })

  it('allows system content', () => {
    const label = makeLabel('system', 'internal')
    const result = canWriteSemanticMemory(label)
    expect(result.allowed).toBe(true)
  })
})

describe('canWriteWorkingMemory', () => {
  it('blocks secret data', () => {
    const label = makeLabel('user', 'secret')
    const result = canWriteWorkingMemory(label)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('redacted')
  })

  it('allows untrusted non-secret data', () => {
    const label = makeLabel('untrusted', 'internal')
    const result = canWriteWorkingMemory(label)
    expect(result.allowed).toBe(true)
  })

  it('allows sensitive data', () => {
    const label = makeLabel('user', 'sensitive')
    const result = canWriteWorkingMemory(label)
    expect(result.allowed).toBe(true)
  })
})

describe('canChainTools', () => {
  it('asks when untrusted content goes to leaky tool', () => {
    const label = makeLabel('untrusted', 'internal')
    const tool = { canLeakData: true }
    const result = canChainTools(label, tool)
    expect(result.allowed).toBe('ask')
  })

  it('blocks secret data to non-sanitizing tool', () => {
    const label = makeLabel('user', 'secret')
    const tool = { sanitizesOutput: false }
    const result = canChainTools(label, tool)
    expect(result.allowed).toBe(false)
  })

  it('allows secret data to sanitizing tool', () => {
    const label = makeLabel('user', 'secret')
    const tool = { sanitizesOutput: true }
    const result = canChainTools(label, tool)
    expect(result.allowed).toBe(true)
  })

  it('allows user content to any tool', () => {
    const label = makeLabel('user', 'internal')
    const tool = { canLeakData: true }
    const result = canChainTools(label, tool)
    expect(result.allowed).toBe(true)
  })
})
