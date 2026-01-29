import { describe, it, expect, beforeEach } from 'vitest'
import { WorkingMemory } from '../../../src/memory/working/index.js'
import type { ContentLabel } from '../../../src/security/labels/types.js'

// Helper to create a valid ContentLabel
function createLabel(overrides: Partial<ContentLabel> = {}): ContentLabel {
  return {
    trustLevel: 'user',
    dataClass: 'internal',
    source: {
      origin: 'test',
      timestamp: new Date(),
    },
    ...overrides,
  }
}

describe('WorkingMemory', () => {
  let memory: WorkingMemory

  beforeEach(() => {
    memory = new WorkingMemory()
  })

  describe('basic operations', () => {
    it('starts empty', () => {
      expect(memory.getHistory()).toHaveLength(0)
      expect(memory.getStats().messageCount).toBe(0)
    })

    it('adds messages successfully', () => {
      const result = memory.add('user', 'Hello', createLabel())

      expect(result.success).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(memory.getHistory()).toHaveLength(1)
    })

    it('tracks message roles correctly', () => {
      memory.add('user', 'Hello', createLabel())
      memory.add('assistant', 'Hi there!', createLabel())
      memory.add('system', 'You are helpful', createLabel())

      const history = memory.getHistory()
      expect(history[0].role).toBe('user')
      expect(history[1].role).toBe('assistant')
      expect(history[2].role).toBe('system')
    })

    it('supports all message roles', () => {
      const roles: Array<'user' | 'assistant' | 'system' | 'tool_result'> = [
        'user',
        'assistant',
        'system',
        'tool_result',
      ]

      for (const role of roles) {
        const result = memory.add(role, `${role} message`, createLabel())
        expect(result.success).toBe(true)
      }

      expect(memory.getHistory()).toHaveLength(4)
    })

    it('clears all messages', () => {
      memory.add('user', 'Hello', createLabel())
      memory.add('assistant', 'Hi', createLabel())

      memory.clear()

      expect(memory.getHistory()).toHaveLength(0)
      expect(memory.getStats().messageCount).toBe(0)
    })

    it('returns recent messages', () => {
      memory.add('user', 'First', createLabel())
      memory.add('user', 'Second', createLabel())
      memory.add('user', 'Third', createLabel())

      const recent = memory.getRecent(2)
      expect(recent).toHaveLength(2)
      expect(recent[0].content).toBe('Second')
      expect(recent[1].content).toBe('Third')
    })

    it('finds messages by role', () => {
      memory.add('user', 'User 1', createLabel())
      memory.add('assistant', 'Assistant 1', createLabel())
      memory.add('user', 'User 2', createLabel())

      const userMessages = memory.findByRole('user')
      expect(userMessages).toHaveLength(2)
      expect(userMessages[0].content).toBe('User 1')
      expect(userMessages[1].content).toBe('User 2')
    })
  })

  describe('message limit enforcement', () => {
    it('enforces maxMessages limit', () => {
      const smallMemory = new WorkingMemory({ maxMessages: 5, maxTokens: 100000 })

      for (let i = 0; i < 10; i++) {
        smallMemory.add('user', `Message ${i}`, createLabel())
      }

      expect(smallMemory.getHistory()).toHaveLength(5)
    })

    it('removes oldest non-system messages first', () => {
      const smallMemory = new WorkingMemory({ maxMessages: 3, maxTokens: 100000 })

      smallMemory.add('system', 'System prompt', createLabel())
      smallMemory.add('user', 'User 1', createLabel())
      smallMemory.add('user', 'User 2', createLabel())
      smallMemory.add('user', 'User 3', createLabel()) // This should trigger removal

      const history = smallMemory.getHistory()
      expect(history).toHaveLength(3)
      expect(history[0].role).toBe('system')
      expect(history[0].content).toBe('System prompt')
    })

    it('preserves system messages during truncation', () => {
      const smallMemory = new WorkingMemory({ maxMessages: 3, maxTokens: 100000 })

      smallMemory.add('system', 'System 1', createLabel())
      smallMemory.add('system', 'System 2', createLabel())
      smallMemory.add('user', 'User 1', createLabel())
      smallMemory.add('user', 'User 2', createLabel())

      const history = smallMemory.getHistory()
      expect(history).toHaveLength(3)

      // Both system messages should be preserved
      const systemMessages = history.filter((m) => m.role === 'system')
      expect(systemMessages).toHaveLength(2)
    })
  })

  describe('token limit enforcement', () => {
    it('enforces maxTokens limit', () => {
      // Each message will be ~25 tokens (100 chars / 4)
      const smallMemory = new WorkingMemory({ maxMessages: 100, maxTokens: 50 })

      const longMessage = 'A'.repeat(100) // ~25 tokens

      smallMemory.add('user', longMessage, createLabel())
      smallMemory.add('user', longMessage, createLabel())
      smallMemory.add('user', longMessage, createLabel())

      // Should have removed messages to stay under 50 tokens
      expect(smallMemory.getStats().estimatedTokens).toBeLessThanOrEqual(50)
    })

    it('preserves system messages during token enforcement', () => {
      const smallMemory = new WorkingMemory({ maxMessages: 100, maxTokens: 100 })

      smallMemory.add('system', 'System prompt', createLabel())
      smallMemory.add('user', 'A'.repeat(200), createLabel()) // ~50 tokens
      smallMemory.add('user', 'B'.repeat(200), createLabel()) // ~50 tokens

      const history = smallMemory.getHistory()
      const systemMessages = history.filter((m) => m.role === 'system')
      expect(systemMessages.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('label combination', () => {
    it('returns system label when empty', () => {
      const label = memory.getLabel()
      expect(label.trustLevel).toBe('system')
    })

    it('returns first message label for single message', () => {
      memory.add('user', 'Hello', createLabel({ trustLevel: 'user' }))

      const label = memory.getLabel()
      expect(label.trustLevel).toBe('user')
    })

    it('combines labels - lowest trust wins', () => {
      memory.add('user', 'User message', createLabel({ trustLevel: 'user' }))
      memory.add('assistant', 'Response', createLabel({ trustLevel: 'untrusted' }))

      const label = memory.getLabel()
      expect(label.trustLevel).toBe('untrusted')
    })

    it('combines labels - highest sensitivity wins', () => {
      memory.add('user', 'Public info', createLabel({ dataClass: 'public' }))
      memory.add('assistant', 'Sensitive info', createLabel({ dataClass: 'sensitive' }))

      const label = memory.getLabel()
      expect(label.dataClass).toBe('sensitive')
    })

    it('clears combined label on clear()', () => {
      memory.add('user', 'Hello', createLabel({ trustLevel: 'untrusted' }))
      memory.clear()

      const label = memory.getLabel()
      expect(label.trustLevel).toBe('system')
    })
  })

  describe('secret redaction (FC-3)', () => {
    it('redacts API keys in messages', () => {
      // GitHub token pattern: ghp_ + 36 alphanumeric chars
      const result = memory.add(
        'user',
        'My token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
        createLabel()
      )

      expect(result.success).toBe(true)
      expect(result.redacted).toBe(true)

      const history = memory.getHistory()
      expect(history[0].content).toContain('[REDACTED')
      expect(history[0].redacted).toBe(true)
    })

    it('redacts GitHub tokens', () => {
      const result = memory.add(
        'user',
        'Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
        createLabel()
      )

      expect(result.redacted).toBe(true)
      expect(memory.getHistory()[0].content).toContain('[REDACTED')
    })

    it('does not redact system messages', () => {
      // System messages might contain configuration patterns that look like secrets
      const result = memory.add(
        'system',
        'API key pattern: sk-ant-api...',
        createLabel()
      )

      expect(result.success).toBe(true)
      // System messages are not scanned for secrets
    })

    it('blocks messages with secret data class (FC-3)', () => {
      const result = memory.add(
        'user',
        'Secret content',
        createLabel({ dataClass: 'secret' })
      )

      expect(result.success).toBe(false)
      expect(result.flowDecision?.allowed).toBe(false)
      expect(result.flowDecision?.reason).toContain('redacted')
    })
  })

  describe('statistics', () => {
    it('tracks message count', () => {
      memory.add('user', 'One', createLabel())
      memory.add('user', 'Two', createLabel())
      memory.add('user', 'Three', createLabel())

      expect(memory.getStats().messageCount).toBe(3)
    })

    it('estimates tokens', () => {
      memory.add('user', 'A'.repeat(100), createLabel()) // ~25 tokens

      const stats = memory.getStats()
      expect(stats.estimatedTokens).toBeGreaterThan(20)
      expect(stats.estimatedTokens).toBeLessThan(30)
    })

    it('tracks system message count', () => {
      memory.add('system', 'System 1', createLabel())
      memory.add('user', 'User 1', createLabel())
      memory.add('system', 'System 2', createLabel())

      expect(memory.getStats().systemMessageCount).toBe(2)
    })
  })

  describe('provider format', () => {
    it('formats messages for provider', () => {
      memory.add('user', 'Hello', createLabel())
      memory.add('assistant', 'Hi!', createLabel())

      const formatted = memory.getMessagesForProvider()

      expect(formatted).toHaveLength(2)
      expect(formatted[0]).toEqual({ role: 'user', content: 'Hello' })
      expect(formatted[1]).toEqual({ role: 'assistant', content: 'Hi!' })
    })

    it('converts tool_result to user role for provider', () => {
      memory.add('tool_result', 'Tool output', createLabel())

      const formatted = memory.getMessagesForProvider()

      expect(formatted[0].role).toBe('user')
    })
  })
})
