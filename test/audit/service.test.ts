import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuditLogger, resetAuditLogger, getAuditLogger } from '../../src/audit/service.js'
import type { AuditStore } from '../../src/audit/store/interface.js'
import type { AuditEntry } from '../../src/audit/schema.js'

describe('AuditLogger', () => {
  let mockStore: AuditStore
  let appendedEntries: AuditEntry[]

  beforeEach(() => {
    appendedEntries = []
    mockStore = {
      append: vi.fn(async (entry: AuditEntry) => {
        appendedEntries.push(entry)
      }),
      query: vi.fn(async () => appendedEntries),
    }
    resetAuditLogger()
  })

  describe('log', () => {
    it('creates entry with required fields', async () => {
      const logger = new AuditLogger(mockStore)

      await logger.log({
        category: 'tool',
        action: 'execute',
      })

      expect(appendedEntries.length).toBe(1)
      expect(appendedEntries[0].id).toBeTruthy()
      expect(appendedEntries[0].timestamp).toBeInstanceOf(Date)
      expect(appendedEntries[0].category).toBe('tool')
      expect(appendedEntries[0].action).toBe('execute')
      expect(appendedEntries[0].severity).toBe('info') // default
    })

    it('includes optional fields when provided', async () => {
      const logger = new AuditLogger(mockStore)

      await logger.log({
        category: 'auth',
        action: 'login',
        severity: 'warning',
        requestId: 'req-123',
        sessionId: 'sess-456',
        userId: 'user-789',
        metadata: { ip: '127.0.0.1' },
      })

      const entry = appendedEntries[0]
      expect(entry.severity).toBe('warning')
      expect(entry.requestId).toBe('req-123')
      expect(entry.sessionId).toBe('sess-456')
      expect(entry.userId).toBe('user-789')
      expect(entry.metadata).toEqual({ ip: '127.0.0.1' })
    })

    it('generates unique IDs for each entry', async () => {
      const logger = new AuditLogger(mockStore)

      await logger.log({ category: 'tool', action: 'a' })
      await logger.log({ category: 'tool', action: 'b' })

      expect(appendedEntries[0].id).not.toBe(appendedEntries[1].id)
    })
  })

  describe('convenience methods', () => {
    it('debug sets severity to debug', async () => {
      const logger = new AuditLogger(mockStore)
      await logger.debug('tool', 'test')
      expect(appendedEntries[0].severity).toBe('debug')
    })

    it('info sets severity to info', async () => {
      const logger = new AuditLogger(mockStore)
      await logger.info('tool', 'test')
      expect(appendedEntries[0].severity).toBe('info')
    })

    it('warning sets severity to warning', async () => {
      const logger = new AuditLogger(mockStore)
      await logger.warning('tool', 'test')
      expect(appendedEntries[0].severity).toBe('warning')
    })

    it('alert sets severity to alert', async () => {
      const logger = new AuditLogger(mockStore)
      await logger.alert('tool', 'test')
      expect(appendedEntries[0].severity).toBe('alert')
    })

    it('critical sets severity to critical', async () => {
      const logger = new AuditLogger(mockStore)
      await logger.critical('tool', 'test')
      expect(appendedEntries[0].severity).toBe('critical')
    })

    it('convenience methods accept metadata', async () => {
      const logger = new AuditLogger(mockStore)
      await logger.info('tool', 'test', { key: 'value' })
      expect(appendedEntries[0].metadata).toEqual({ key: 'value' })
    })
  })

  describe('query', () => {
    it('delegates to store', async () => {
      const logger = new AuditLogger(mockStore)
      await logger.query({ category: 'tool' })

      expect(mockStore.query).toHaveBeenCalledWith({ category: 'tool' })
    })
  })

  describe('singleton', () => {
    it('getAuditLogger returns same instance', () => {
      const logger1 = getAuditLogger()
      const logger2 = getAuditLogger()
      expect(logger1).toBe(logger2)
    })

    it('resetAuditLogger clears the singleton', () => {
      const logger1 = getAuditLogger()
      resetAuditLogger()
      const logger2 = getAuditLogger()
      expect(logger1).not.toBe(logger2)
    })
  })
})
