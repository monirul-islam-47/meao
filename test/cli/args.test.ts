/**
 * Tests for CLI argument parser
 */

import { describe, it, expect } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'

describe('Argument Parser', () => {
  describe('parseArgs', () => {
    it('parses empty args', () => {
      const result = parseArgs([])
      expect(result.command).toBeUndefined()
      expect(result.args).toEqual([])
      expect(result.flags).toEqual({})
    })

    it('parses single command', () => {
      const result = parseArgs(['demo'])
      expect(result.command).toBe('demo')
      expect(result.args).toEqual([])
    })

    it('parses command with subcommand', () => {
      const result = parseArgs(['demo', 'list'])
      expect(result.command).toBe('demo')
      expect(result.args).toEqual(['list'])
    })

    it('parses command with multiple args', () => {
      const result = parseArgs(['demo', 'show', 'golden-path'])
      expect(result.command).toBe('demo')
      expect(result.args).toEqual(['show', 'golden-path'])
    })

    it('parses --help flag', () => {
      const result = parseArgs(['--help'])
      expect(result.flags.help).toBe(true)
    })

    it('parses -h flag', () => {
      const result = parseArgs(['-h'])
      expect(result.flags.help).toBe(true)
    })

    it('parses --version flag', () => {
      const result = parseArgs(['--version'])
      expect(result.flags.version).toBe(true)
    })

    it('parses -v flag', () => {
      const result = parseArgs(['-v'])
      expect(result.flags.version).toBe(true)
    })

    it('parses flag with value', () => {
      const result = parseArgs(['--model', 'claude-3-opus'])
      expect(result.flags.model).toBe('claude-3-opus')
    })

    it('parses mixed flags and commands', () => {
      const result = parseArgs(['demo', 'run', 'golden-path', '--model', 'opus'])
      expect(result.command).toBe('demo')
      expect(result.args).toEqual(['run', 'golden-path'])
      expect(result.flags.model).toBe('opus')
    })

    it('parses work-dir flag', () => {
      const result = parseArgs(['--work-dir', '/path/to/project'])
      expect(result.flags['work-dir']).toBe('/path/to/project')
    })
  })
})
