import { describe, it, expect } from 'vitest'
import {
  combineLabels,
  propagateLabel,
  minTrust,
  maxSensitivity,
  meetsTrustRequirement,
  withinDataClass,
} from '../../../src/security/labels/propagation.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'

describe('combineLabels', () => {
  const makeLabel = (
    trustLevel: ContentLabel['trustLevel'],
    dataClass: ContentLabel['dataClass']
  ): ContentLabel => ({
    trustLevel,
    dataClass,
    source: { origin: 'test', timestamp: new Date() },
  })

  it('uses lowest trust level', () => {
    const a = makeLabel('user', 'public')
    const b = makeLabel('untrusted', 'public')
    const result = combineLabels(a, b)
    expect(result.trustLevel).toBe('untrusted')
  })

  it('uses highest sensitivity', () => {
    const a = makeLabel('user', 'public')
    const b = makeLabel('user', 'sensitive')
    const result = combineLabels(a, b)
    expect(result.dataClass).toBe('sensitive')
  })

  it('combines both rules correctly', () => {
    const a = makeLabel('user', 'internal')
    const b = makeLabel('untrusted', 'sensitive')
    const result = combineLabels(a, b)
    expect(result.trustLevel).toBe('untrusted')
    expect(result.dataClass).toBe('sensitive')
  })

  it('preserves inheritedFrom', () => {
    const a = makeLabel('user', 'public')
    const b = makeLabel('untrusted', 'public')
    const result = combineLabels(a, b)
    expect(result.inheritedFrom).toBeDefined()
    // Should inherit from the less trusted source
    expect(result.inheritedFrom?.trustLevel).toBe('untrusted')
  })

  it('sets combined origin', () => {
    const a = makeLabel('user', 'public')
    const b = makeLabel('verified', 'internal')
    const result = combineLabels(a, b)
    expect(result.source.origin).toBe('combined')
  })
})

describe('propagateLabel', () => {
  const makeLabel = (
    trustLevel: ContentLabel['trustLevel'],
    dataClass: ContentLabel['dataClass']
  ): ContentLabel => ({
    trustLevel,
    dataClass,
    source: { origin: 'test', timestamp: new Date() },
  })

  it('returns default for empty inputs', () => {
    const result = propagateLabel([], 'new_origin')
    expect(result.trustLevel).toBe('untrusted')
    expect(result.dataClass).toBe('internal')
  })

  it('handles single input', () => {
    const input = makeLabel('user', 'sensitive')
    const result = propagateLabel([input], 'derived')
    expect(result.trustLevel).toBe('user')
    expect(result.dataClass).toBe('sensitive')
    expect(result.source.origin).toBe('derived')
    expect(result.inheritedFrom).toBe(input)
  })

  it('combines multiple inputs', () => {
    const inputs = [
      makeLabel('user', 'public'),
      makeLabel('verified', 'internal'),
      makeLabel('untrusted', 'sensitive'),
    ]
    const result = propagateLabel(inputs, 'combined_result')
    expect(result.trustLevel).toBe('untrusted')
    expect(result.dataClass).toBe('sensitive')
  })
})

describe('minTrust', () => {
  it('returns untrusted as lowest', () => {
    expect(minTrust('untrusted', 'system')).toBe('untrusted')
    expect(minTrust('system', 'untrusted')).toBe('untrusted')
  })

  it('orders correctly', () => {
    expect(minTrust('user', 'verified')).toBe('verified')
    expect(minTrust('system', 'user')).toBe('user')
  })
})

describe('maxSensitivity', () => {
  it('returns secret as highest', () => {
    expect(maxSensitivity('secret', 'public')).toBe('secret')
    expect(maxSensitivity('public', 'secret')).toBe('secret')
  })

  it('orders correctly', () => {
    expect(maxSensitivity('internal', 'sensitive')).toBe('sensitive')
    expect(maxSensitivity('public', 'internal')).toBe('internal')
  })
})

describe('meetsTrustRequirement', () => {
  it('system meets all requirements', () => {
    expect(meetsTrustRequirement('system', 'untrusted')).toBe(true)
    expect(meetsTrustRequirement('system', 'verified')).toBe(true)
    expect(meetsTrustRequirement('system', 'user')).toBe(true)
    expect(meetsTrustRequirement('system', 'system')).toBe(true)
  })

  it('untrusted only meets untrusted', () => {
    expect(meetsTrustRequirement('untrusted', 'untrusted')).toBe(true)
    expect(meetsTrustRequirement('untrusted', 'verified')).toBe(false)
    expect(meetsTrustRequirement('untrusted', 'user')).toBe(false)
  })

  it('user meets user, verified, untrusted', () => {
    expect(meetsTrustRequirement('user', 'user')).toBe(true)
    expect(meetsTrustRequirement('user', 'verified')).toBe(true)
    expect(meetsTrustRequirement('user', 'untrusted')).toBe(true)
    expect(meetsTrustRequirement('user', 'system')).toBe(false)
  })
})

describe('withinDataClass', () => {
  it('secret exceeds all except secret', () => {
    expect(withinDataClass('secret', 'secret')).toBe(true)
    expect(withinDataClass('secret', 'sensitive')).toBe(false)
    expect(withinDataClass('secret', 'public')).toBe(false)
  })

  it('public is within everything', () => {
    expect(withinDataClass('public', 'public')).toBe(true)
    expect(withinDataClass('public', 'internal')).toBe(true)
    expect(withinDataClass('public', 'sensitive')).toBe(true)
    expect(withinDataClass('public', 'secret')).toBe(true)
  })
})
