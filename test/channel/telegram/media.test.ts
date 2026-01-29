import { describe, it, expect } from 'vitest'
import { sanitizeFilename, MAX_FILE_SIZE } from '../../../src/channel/telegram/media.js'

describe('Media module', () => {
  describe('MAX_FILE_SIZE', () => {
    it('is 50MB', () => {
      expect(MAX_FILE_SIZE).toBe(50 * 1024 * 1024)
    })
  })

  describe('sanitizeFilename', () => {
    it('allows safe filenames', () => {
      expect(sanitizeFilename('document.pdf')).toBe('document.pdf')
      expect(sanitizeFilename('my-file_v2.txt')).toBe('my-file_v2.txt')
    })

    it('removes path traversal attempts', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd')
      // Windows-style backslash paths are normalized
      expect(sanitizeFilename('..\\..\\windows\\system32\\config')).toBe('config')
    })

    it('removes special characters', () => {
      expect(sanitizeFilename('file<script>.txt')).toBe('file_script_.txt')
      expect(sanitizeFilename('file name with spaces.pdf')).toBe('file_name_with_spaces.pdf')
      // Forward slash is treated as path separator, so basename extracts '.txt'
      // which after leading dot removal becomes 'txt'
      expect(sanitizeFilename('file;rm -rf /.txt')).toBe('txt')
    })

    it('removes leading dots (hidden files)', () => {
      expect(sanitizeFilename('.hidden')).toBe('hidden')
      expect(sanitizeFilename('...secret')).toBe('secret')
    })

    it('collapses multiple dots', () => {
      expect(sanitizeFilename('file..txt')).toBe('file.txt')
      expect(sanitizeFilename('file...multiple...dots.pdf')).toBe('file.multiple.dots.pdf')
    })

    it('adds fallback extension when missing', () => {
      expect(sanitizeFilename('noextension', 'pdf')).toBe('noextension.pdf')
      expect(sanitizeFilename('noextension', '.pdf')).toBe('noextension.pdf')
    })

    it('does not add fallback extension if one exists', () => {
      expect(sanitizeFilename('file.txt', 'pdf')).toBe('file.txt')
    })

    it('truncates very long filenames', () => {
      const longName = 'a'.repeat(300) + '.txt'
      const sanitized = sanitizeFilename(longName)
      expect(sanitized.length).toBe(255)
      expect(sanitized.endsWith('.txt')).toBe(true)
    })

    it('generates random name for empty input', () => {
      const sanitized = sanitizeFilename('', 'pdf')
      expect(sanitized).toMatch(/^file_[0-9a-f-]+\.pdf$/)
    })

    it('generates random name when only special chars', () => {
      const sanitized = sanitizeFilename('...', 'txt')
      expect(sanitized).toMatch(/^file_[0-9a-f-]+\.txt$/)
    })

    it('handles null bytes and control characters', () => {
      expect(sanitizeFilename('file\x00name.txt')).toBe('file_name.txt')
      expect(sanitizeFilename('file\nname.txt')).toBe('file_name.txt')
    })
  })
})
