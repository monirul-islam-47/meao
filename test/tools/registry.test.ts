import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  ToolRegistry,
  getToolRegistry,
  resetToolRegistry,
} from '../../src/tools/registry.js'
import type { ToolPlugin } from '../../src/tools/types.js'

const createMockTool = (name: string): ToolPlugin => ({
  name,
  description: `Mock tool ${name}`,
  parameters: z.object({}),
  capability: {
    name,
    approval: { level: 'auto' },
  },
  actions: [],
  execute: async () => ({ success: true, output: '' }),
})

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('register', () => {
    it('registers a tool', () => {
      const tool = createMockTool('test')
      registry.register(tool)
      expect(registry.has('test')).toBe(true)
    })

    it('throws on duplicate registration', () => {
      const tool = createMockTool('test')
      registry.register(tool)
      expect(() => registry.register(tool)).toThrow(/already registered/)
    })
  })

  describe('get', () => {
    it('returns registered tool', () => {
      const tool = createMockTool('test')
      registry.register(tool)
      expect(registry.get('test')).toBe(tool)
    })

    it('returns undefined for unregistered tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })
  })

  describe('has', () => {
    it('returns true for registered tool', () => {
      registry.register(createMockTool('test'))
      expect(registry.has('test')).toBe(true)
    })

    it('returns false for unregistered tool', () => {
      expect(registry.has('nonexistent')).toBe(false)
    })
  })

  describe('all', () => {
    it('returns all registered tools', () => {
      registry.register(createMockTool('tool1'))
      registry.register(createMockTool('tool2'))

      const all = registry.all()
      expect(all).toHaveLength(2)
      expect(all.map((t) => t.name)).toContain('tool1')
      expect(all.map((t) => t.name)).toContain('tool2')
    })
  })

  describe('names', () => {
    it('returns all tool names', () => {
      registry.register(createMockTool('tool1'))
      registry.register(createMockTool('tool2'))

      const names = registry.names()
      expect(names).toContain('tool1')
      expect(names).toContain('tool2')
    })
  })

  describe('unregister', () => {
    it('removes a tool', () => {
      registry.register(createMockTool('test'))
      expect(registry.unregister('test')).toBe(true)
      expect(registry.has('test')).toBe(false)
    })

    it('returns false for nonexistent tool', () => {
      expect(registry.unregister('nonexistent')).toBe(false)
    })
  })

  describe('clear', () => {
    it('removes all tools', () => {
      registry.register(createMockTool('tool1'))
      registry.register(createMockTool('tool2'))
      registry.clear()
      expect(registry.all()).toHaveLength(0)
    })
  })
})

describe('getToolRegistry', () => {
  beforeEach(() => {
    resetToolRegistry()
  })

  it('returns same instance', () => {
    const r1 = getToolRegistry()
    const r2 = getToolRegistry()
    expect(r1).toBe(r2)
  })

  it('can be reset', () => {
    const r1 = getToolRegistry()
    resetToolRegistry()
    const r2 = getToolRegistry()
    expect(r1).not.toBe(r2)
  })
})
