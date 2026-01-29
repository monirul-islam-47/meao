import { describe, it, expect } from 'vitest'
import { deepMerge, setPath, getPath } from '../../src/config/merge.js'

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const target = { a: 1, b: 2 }
    const source = { b: 3, c: 4 }
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('merges nested objects', () => {
    const target = { server: { host: 'localhost', port: 3000 } }
    const source = { server: { port: 4000 } } as Partial<typeof target>
    expect(deepMerge(target, source)).toEqual({
      server: { host: 'localhost', port: 4000 },
    })
  })

  it('replaces arrays (does not merge)', () => {
    const target = { items: [1, 2, 3] }
    const source = { items: [4, 5] }
    expect(deepMerge(target, source)).toEqual({ items: [4, 5] })
  })

  it('ignores undefined values in source', () => {
    const target = { a: 1, b: 2 }
    const source = { a: undefined, c: 3 }
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('handles null values in source', () => {
    const target = { a: { nested: 1 } }
    const source = { a: null }
    expect(deepMerge(target, source as Record<string, unknown>)).toEqual({ a: null })
  })

  it('does not mutate target', () => {
    const target = { a: 1, b: 0 }
    const source = { b: 2 }
    deepMerge(target, source)
    expect(target).toEqual({ a: 1, b: 0 })
  })

  it('handles deeply nested objects', () => {
    const target = {
      level1: {
        level2: {
          level3: {
            value: 'original',
          },
        },
      },
    }
    const source = {
      level1: {
        level2: {
          level3: {
            value: 'updated',
          },
        },
      },
    }
    expect(deepMerge(target, source)).toEqual({
      level1: {
        level2: {
          level3: {
            value: 'updated',
          },
        },
      },
    })
  })
})

describe('setPath', () => {
  it('sets a simple path', () => {
    const obj: Record<string, unknown> = {}
    setPath(obj, 'foo', 'bar')
    expect(obj).toEqual({ foo: 'bar' })
  })

  it('sets a nested path', () => {
    const obj: Record<string, unknown> = {}
    setPath(obj, 'server.host', 'localhost')
    expect(obj).toEqual({ server: { host: 'localhost' } })
  })

  it('sets a deeply nested path', () => {
    const obj: Record<string, unknown> = {}
    setPath(obj, 'a.b.c.d', 'value')
    expect(obj).toEqual({ a: { b: { c: { d: 'value' } } } })
  })

  it('preserves existing values', () => {
    const obj: Record<string, unknown> = { server: { host: 'localhost' } }
    setPath(obj, 'server.port', 3000)
    expect(obj).toEqual({ server: { host: 'localhost', port: 3000 } })
  })

  it('overwrites non-object values', () => {
    const obj: Record<string, unknown> = { server: 'string' }
    setPath(obj, 'server.port', 3000)
    expect(obj).toEqual({ server: { port: 3000 } })
  })
})

describe('getPath', () => {
  it('gets a simple path', () => {
    const obj = { foo: 'bar' }
    expect(getPath(obj, 'foo')).toBe('bar')
  })

  it('gets a nested path', () => {
    const obj = { server: { host: 'localhost' } }
    expect(getPath(obj, 'server.host')).toBe('localhost')
  })

  it('returns undefined for missing path', () => {
    const obj = { foo: 'bar' }
    expect(getPath(obj, 'baz')).toBeUndefined()
  })

  it('returns undefined for partially missing path', () => {
    const obj = { server: { host: 'localhost' } }
    expect(getPath(obj, 'server.port')).toBeUndefined()
  })

  it('returns undefined for path through non-object', () => {
    const obj = { server: 'string' }
    expect(getPath(obj, 'server.host')).toBeUndefined()
  })
})
