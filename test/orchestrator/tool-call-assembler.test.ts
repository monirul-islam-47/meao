import { describe, it, expect, beforeEach } from 'vitest'
import {
  ToolCallAssembler,
  createToolCallAssembler,
} from '../../src/orchestrator/tool-call-assembler.js'

describe('ToolCallAssembler', () => {
  let assembler: ToolCallAssembler

  beforeEach(() => {
    assembler = createToolCallAssembler()
  })

  describe('basic functionality', () => {
    it('assembles a simple tool call', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"path": "test.txt"}')
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.id).toBe('call-1')
        expect(result.toolCall.name).toBe('read')
        expect(result.toolCall.input).toEqual({ path: 'test.txt' })
      }
    })

    it('handles empty input', () => {
      assembler.startToolCall('call-1', 'list')
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.input).toEqual({})
      }
    })

    it('accumulates completed calls', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"path": "a.txt"}')
      assembler.endToolCall('call-1')

      assembler.startToolCall('call-2', 'write')
      assembler.addDelta('call-2', '{"path": "b.txt", "content": "hello"}')
      assembler.endToolCall('call-2')

      const completed = assembler.getCompletedCalls()
      expect(completed).toHaveLength(2)
      expect(completed[0].name).toBe('read')
      expect(completed[1].name).toBe('write')
    })
  })

  describe('JSON split across deltas', () => {
    it('handles JSON split into multiple chunks', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"pa')
      assembler.addDelta('call-1', 'th":')
      assembler.addDelta('call-1', ' "te')
      assembler.addDelta('call-1', 'st.')
      assembler.addDelta('call-1', 'txt"')
      assembler.addDelta('call-1', '}')
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.input).toEqual({ path: 'test.txt' })
      }
    })

    it('handles complex JSON split across many deltas', () => {
      const fullJson = JSON.stringify({
        path: '/very/long/path/to/file.txt',
        content: 'This is some content that spans multiple lines.\nLine 2.\nLine 3.',
        encoding: 'utf-8',
        createDirs: true,
      })

      assembler.startToolCall('call-1', 'write')

      // Split into 10-char chunks
      for (let i = 0; i < fullJson.length; i += 10) {
        assembler.addDelta('call-1', fullJson.slice(i, i + 10))
      }

      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.input).toEqual({
          path: '/very/long/path/to/file.txt',
          content: 'This is some content that spans multiple lines.\nLine 2.\nLine 3.',
          encoding: 'utf-8',
          createDirs: true,
        })
      }
    })

    it('handles single-character deltas', () => {
      const json = '{"a":1}'
      assembler.startToolCall('call-1', 'test')

      for (const char of json) {
        assembler.addDelta('call-1', char)
      }

      const result = assembler.endToolCall('call-1')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.input).toEqual({ a: 1 })
      }
    })
  })

  describe('multiple tool calls in one message', () => {
    it('handles two tool calls back-to-back', () => {
      // First tool call
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"path": "input.txt"}')
      const result1 = assembler.endToolCall('call-1')

      // Second tool call
      assembler.startToolCall('call-2', 'write')
      assembler.addDelta('call-2', '{"path": "output.txt", "content": "data"}')
      const result2 = assembler.endToolCall('call-2')

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      const completed = assembler.getCompletedCalls()
      expect(completed).toHaveLength(2)
      expect(completed[0].input).toEqual({ path: 'input.txt' })
      expect(completed[1].input).toEqual({ path: 'output.txt', content: 'data' })
    })

    it('handles interleaved tool call deltas', () => {
      // Start both
      assembler.startToolCall('call-1', 'read')
      assembler.startToolCall('call-2', 'bash')

      // Interleave deltas
      assembler.addDelta('call-1', '{"pa')
      assembler.addDelta('call-2', '{"com')
      assembler.addDelta('call-1', 'th": ')
      assembler.addDelta('call-2', 'mand":')
      assembler.addDelta('call-1', '"file.txt"}')
      assembler.addDelta('call-2', ' "ls -la"}')

      // Complete both
      const result1 = assembler.endToolCall('call-1')
      const result2 = assembler.endToolCall('call-2')

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      if (result1.success && result2.success) {
        expect(result1.toolCall.input).toEqual({ path: 'file.txt' })
        expect(result2.toolCall.input).toEqual({ command: 'ls -la' })
      }
    })

    it('handles three tool calls sequentially', () => {
      const tools = [
        { id: 'call-1', name: 'read', input: { path: 'a.txt' } },
        { id: 'call-2', name: 'bash', input: { command: 'wc -l' } },
        { id: 'call-3', name: 'write', input: { path: 'result.txt', content: '42' } },
      ]

      for (const tool of tools) {
        assembler.startToolCall(tool.id, tool.name)
        assembler.addDelta(tool.id, JSON.stringify(tool.input))
        assembler.endToolCall(tool.id)
      }

      const completed = assembler.getCompletedCalls()
      expect(completed).toHaveLength(3)
      expect(completed.map((c) => c.name)).toEqual(['read', 'bash', 'write'])
    })
  })

  describe('error handling', () => {
    it('returns error for invalid JSON', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"path": invalid}')
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.id).toBe('call-1')
        expect(result.error.error).toContain('Invalid tool call JSON')
        expect(result.error.partialJson).toBe('{"path": invalid}')
      }
    })

    it('returns error for end without start', () => {
      const result = assembler.endToolCall('nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.error).toContain('end without start')
      }
    })

    it('handles delta for unknown call gracefully', () => {
      // This shouldn't throw
      assembler.addDelta('unknown-call', '{"test": 1}')

      // Should have created a partial call
      expect(assembler.hasIncompleteCalls()).toBe(true)
    })

    it('accumulates errors', () => {
      assembler.startToolCall('call-1', 'a')
      assembler.addDelta('call-1', 'not json')
      assembler.endToolCall('call-1')

      assembler.startToolCall('call-2', 'b')
      assembler.addDelta('call-2', '{also not json')
      assembler.endToolCall('call-2')

      const errors = assembler.getErrors()
      expect(errors).toHaveLength(2)
    })
  })

  describe('stream abort / incomplete calls', () => {
    it('detects incomplete calls', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"path": "te')
      // Never call endToolCall

      expect(assembler.hasIncompleteCalls()).toBe(true)
      expect(assembler.getIncompleteCallIds()).toEqual(['call-1'])
    })

    it('fails incomplete calls on stream abort', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"path": ')

      assembler.startToolCall('call-2', 'write')
      assembler.addDelta('call-2', '{"content":')

      const failures = assembler.failIncompleteCalls('Stream disconnected')

      expect(failures).toHaveLength(2)
      expect(failures[0].error).toBe('Stream disconnected')
      expect(failures[1].error).toBe('Stream disconnected')

      // Should have moved to errors
      expect(assembler.getErrors()).toHaveLength(2)

      // Should no longer have incomplete calls
      expect(assembler.hasIncompleteCalls()).toBe(false)
    })

    it('preserves partial JSON in failure error', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{"path": "partial')

      const failures = assembler.failIncompleteCalls('Network error')

      expect(failures[0].partialJson).toBe('{"path": "partial')
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      // Add some completed
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{}')
      assembler.endToolCall('call-1')

      // Add some incomplete
      assembler.startToolCall('call-2', 'write')

      // Add some errors
      assembler.startToolCall('call-3', 'bash')
      assembler.addDelta('call-3', 'bad json')
      assembler.endToolCall('call-3')

      // Reset
      assembler.reset()

      expect(assembler.getCompletedCalls()).toHaveLength(0)
      expect(assembler.getErrors()).toHaveLength(0)
      expect(assembler.hasIncompleteCalls()).toBe(false)
    })
  })

  describe('getState (debugging)', () => {
    it('returns complete state', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '{}')
      assembler.endToolCall('call-1')

      assembler.startToolCall('call-2', 'write')
      assembler.addDelta('call-2', '{"partial":')

      const state = assembler.getState()

      expect(state.completed).toHaveLength(1)
      expect(state.partial).toHaveLength(1)
      expect(state.partial[0].id).toBe('call-2')
      expect(state.partial[0].inputJson).toBe('{"partial":')
    })
  })

  describe('edge cases', () => {
    it('handles empty string deltas', () => {
      assembler.startToolCall('call-1', 'read')
      assembler.addDelta('call-1', '')
      assembler.addDelta('call-1', '{}')
      assembler.addDelta('call-1', '')
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
    })

    it('handles unicode in JSON', () => {
      assembler.startToolCall('call-1', 'write')
      assembler.addDelta('call-1', '{"content": "Hello 世界 🌍"}')
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.input).toEqual({ content: 'Hello 世界 🌍' })
      }
    })

    it('handles nested JSON', () => {
      assembler.startToolCall('call-1', 'complex')
      assembler.addDelta('call-1', JSON.stringify({
        outer: {
          inner: {
            deep: [1, 2, { nested: true }],
          },
        },
        array: [{ a: 1 }, { b: 2 }],
      }))
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.input.outer.inner.deep[2].nested).toBe(true)
      }
    })

    it('handles JSON with escaped characters', () => {
      assembler.startToolCall('call-1', 'write')
      assembler.addDelta('call-1', '{"content": "line1\\nline2\\ttab\\"quote\\""}')
      const result = assembler.endToolCall('call-1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.input.content).toBe('line1\nline2\ttab"quote"')
      }
    })

    it('handles very long tool call IDs', () => {
      const longId = 'call-' + 'x'.repeat(1000)
      assembler.startToolCall(longId, 'test')
      assembler.addDelta(longId, '{}')
      const result = assembler.endToolCall(longId)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.toolCall.id).toBe(longId)
      }
    })
  })
})
