import { describe, it, expect } from 'vitest'
import {
  escapeMarkdown,
  formatCode,
  formatInlineCode,
  formatBold,
  formatItalic,
  formatLink,
  splitMessage,
} from '../../../src/channel/telegram/formatting.js'

describe('Telegram formatting', () => {
  describe('escapeMarkdown', () => {
    it('escapes asterisks', () => {
      expect(escapeMarkdown('Hello *world*')).toBe('Hello \\*world\\*')
    })

    it('escapes underscores', () => {
      expect(escapeMarkdown('Hello _world_')).toBe('Hello \\_world\\_')
    })

    it('escapes brackets', () => {
      expect(escapeMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)')
    })

    it('escapes backticks', () => {
      expect(escapeMarkdown('`code`')).toBe('\\`code\\`')
    })

    it('escapes multiple special characters', () => {
      const input = 'Hello *world* and _test_ with `code`'
      const expected = 'Hello \\*world\\* and \\_test\\_ with \\`code\\`'
      expect(escapeMarkdown(input)).toBe(expected)
    })

    it('leaves plain text unchanged', () => {
      expect(escapeMarkdown('Hello world')).toBe('Hello world')
    })
  })

  describe('formatCode', () => {
    it('formats code block without language', () => {
      const code = 'console.log("hello")'
      expect(formatCode(code)).toBe('```\nconsole.log("hello")\n```')
    })

    it('formats code block with language', () => {
      const code = 'console.log("hello")'
      expect(formatCode(code, 'javascript')).toBe('```javascript\nconsole.log("hello")\n```')
    })
  })

  describe('formatInlineCode', () => {
    it('formats inline code', () => {
      expect(formatInlineCode('const x = 1')).toBe('`const x = 1`')
    })
  })

  describe('formatBold', () => {
    it('formats bold text', () => {
      expect(formatBold('important')).toBe('*important*')
    })
  })

  describe('formatItalic', () => {
    it('formats italic text', () => {
      expect(formatItalic('emphasis')).toBe('_emphasis_')
    })
  })

  describe('formatLink', () => {
    it('formats hyperlink', () => {
      expect(formatLink('Google', 'https://google.com')).toBe('[Google](https://google.com)')
    })
  })

  describe('splitMessage', () => {
    it('returns single chunk for short messages', () => {
      const text = 'Hello world'
      expect(splitMessage(text)).toEqual([text])
    })

    it('splits at newlines', () => {
      const lines = Array(100).fill('Line of text').join('\n')
      const chunks = splitMessage(lines, 100)

      expect(chunks.length).toBeGreaterThan(1)
      // Each chunk should be under the limit
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(100)
      }
    })

    it('splits at spaces when no newline available', () => {
      const words = 'word '.repeat(100)
      const chunks = splitMessage(words, 50)

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(50)
      }
    })

    it('force-splits at maxLength when no good break point', () => {
      const noBreaks = 'a'.repeat(200)
      const chunks = splitMessage(noBreaks, 50)

      expect(chunks.length).toBe(4) // 200 / 50 = 4 chunks
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(50)
      }
    })

    it('uses custom maxLength', () => {
      const text = 'Hello world this is a test'
      const chunks = splitMessage(text, 10)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it('preserves content when splitting', () => {
      const text = 'Hello world\nThis is a test'
      const chunks = splitMessage(text, 15)

      // Joined chunks should equal original (minus trimmed whitespace)
      expect(chunks.join(' ')).toMatch(/Hello.*world.*This.*is.*a.*test/)
    })
  })
})
