/**
 * Tests for demo module
 */

import { describe, it, expect } from 'vitest'
import { getDemo, getDemoPrompt } from '../../src/cli/demo.js'

describe('Demo Module', () => {
  describe('getDemo', () => {
    it('returns golden-path demo', () => {
      const demo = getDemo('golden-path')
      expect(demo).toBeDefined()
      expect(demo?.name).toBe('golden-path')
      expect(demo?.title).toBe('Golden Path')
      expect(demo?.prompt).toContain('lodash')
    })

    it('returns repo-assistant demo', () => {
      const demo = getDemo('repo-assistant')
      expect(demo).toBeDefined()
      expect(demo?.name).toBe('repo-assistant')
      expect(demo?.prompt).toContain('TODO')
    })

    it('returns file-ops demo', () => {
      const demo = getDemo('file-ops')
      expect(demo).toBeDefined()
      expect(demo?.name).toBe('file-ops')
      expect(demo?.prompt).toContain('package.json')
    })

    it('returns undefined for unknown demo', () => {
      expect(getDemo('unknown')).toBeUndefined()
    })
  })

  describe('getDemoPrompt', () => {
    it('returns prompt for valid demo', () => {
      const prompt = getDemoPrompt('golden-path')
      expect(prompt).toBeDefined()
      expect(prompt).toContain('README')
    })

    it('returns undefined for unknown demo', () => {
      expect(getDemoPrompt('unknown')).toBeUndefined()
    })
  })

  describe('demo validation', () => {
    it('all demos have required fields', () => {
      const demoNames = ['golden-path', 'repo-assistant', 'file-ops']
      for (const name of demoNames) {
        const demo = getDemo(name)
        expect(demo?.name).toBeTruthy()
        expect(demo?.title).toBeTruthy()
        expect(demo?.description).toBeTruthy()
        expect(demo?.validates).toBeInstanceOf(Array)
        expect(demo?.validates.length).toBeGreaterThan(0)
        expect(demo?.prompt).toBeTruthy()
      }
    })
  })
})
