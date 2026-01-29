import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MockProvider,
  createMockProvider,
  matchUserMessage,
  createToolUseResponse,
} from '../../src/provider/mock.js'
import type { ConversationMessage, ProviderRequestOptions } from '../../src/provider/types.js'

describe('MockProvider', () => {
  let provider: MockProvider

  beforeEach(() => {
    provider = createMockProvider()
  })

  describe('basic functionality', () => {
    it('has correct name', () => {
      expect(provider.name).toBe('mock')
    })

    it('isAvailable returns true', () => {
      expect(provider.isAvailable()).toBe(true)
    })

    it('countTokens approximates token count', () => {
      const tokens = provider.countTokens('Hello, world!')
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThanOrEqual(13) // ~0.25 tokens per char
    })
  })

  describe('createMessage', () => {
    it('returns default response', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ]
      const options: ProviderRequestOptions = { model: 'test-model' }

      const response = await provider.createMessage(messages, options)

      expect(response.id).toMatch(/^mock-/)
      expect(response.model).toBe('test-model')
      expect(response.content).toHaveLength(1)
      expect(response.content[0]).toEqual({
        type: 'text',
        text: 'This is a mock response.',
      })
      expect(response.stopReason).toBe('end_turn')
    })

    it('uses custom default response', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Custom response' }],
        stopReason: 'max_tokens',
      })

      const response = await provider.createMessage(
        [{ role: 'user', content: 'test' }],
        { model: 'test' }
      )

      expect(response.content[0]).toEqual({
        type: 'text',
        text: 'Custom response',
      })
      expect(response.stopReason).toBe('max_tokens')
    })

    it('uses response generator', async () => {
      provider.addGenerator((messages, options) => ({
        content: [
          {
            type: 'text',
            text: `Received: ${(messages[0].content as string)}`,
          },
        ],
      }))

      const response = await provider.createMessage(
        [{ role: 'user', content: 'Hello' }],
        { model: 'test' }
      )

      expect((response.content[0] as any).text).toBe('Received: Hello')
    })

    it('includes usage information', async () => {
      const response = await provider.createMessage(
        [{ role: 'user', content: 'test' }],
        { model: 'test' }
      )

      expect(response.usage.inputTokens).toBeGreaterThan(0)
      expect(response.usage.outputTokens).toBeGreaterThan(0)
    })
  })

  describe('createMessageStream', () => {
    it('streams response chunks', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Hello, streaming!' }],
      })

      const events: any[] = []
      for await (const event of provider.createMessageStream(
        [{ role: 'user', content: 'test' }],
        { model: 'test' }
      )) {
        events.push(event)
      }

      expect(events.some((e) => e.type === 'message_start')).toBe(true)
      expect(events.some((e) => e.type === 'content_block_start')).toBe(true)
      expect(events.some((e) => e.type === 'content_block_delta')).toBe(true)
      expect(events.some((e) => e.type === 'content_block_stop')).toBe(true)
      expect(events.some((e) => e.type === 'message_delta')).toBe(true)
      expect(events.some((e) => e.type === 'message_stop')).toBe(true)
    })

    it('includes text deltas', async () => {
      provider.setDefaultResponse({
        content: [{ type: 'text', text: 'Hello!' }],
      })

      const deltas: string[] = []
      for await (const event of provider.createMessageStream(
        [{ role: 'user', content: 'test' }],
        { model: 'test' }
      )) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text') {
          deltas.push((event.delta as any).text)
        }
      }

      expect(deltas.join('')).toBe('Hello!')
    })
  })

  describe('reset', () => {
    it('clears generators', async () => {
      provider.addGenerator(() => ({
        content: [{ type: 'text', text: 'Custom' }],
      }))

      provider.reset()

      const response = await provider.createMessage(
        [{ role: 'user', content: 'test' }],
        { model: 'test' }
      )

      expect((response.content[0] as any).text).toBe('This is a mock response.')
    })
  })
})

describe('matchUserMessage', () => {
  it('matches string pattern', async () => {
    const provider = createMockProvider()
    provider.addGenerator(
      matchUserMessage('hello', {
        content: [{ type: 'text', text: 'Matched!' }],
      })
    )

    const response = await provider.createMessage(
      [{ role: 'user', content: 'hello world' }],
      { model: 'test' }
    )

    expect((response.content[0] as any).text).toBe('Matched!')
  })

  it('matches regex pattern', async () => {
    const provider = createMockProvider()
    provider.addGenerator(
      matchUserMessage(/^test\d+/, {
        content: [{ type: 'text', text: 'Regex matched!' }],
      })
    )

    const response = await provider.createMessage(
      [{ role: 'user', content: 'test123' }],
      { model: 'test' }
    )

    expect((response.content[0] as any).text).toBe('Regex matched!')
  })
})

describe('createToolUseResponse', () => {
  it('creates tool use response', () => {
    const response = createToolUseResponse('read', { path: '/test' }, 'tool-1')

    expect(response.content).toHaveLength(1)
    expect(response.content[0]).toEqual({
      type: 'tool_use',
      id: 'tool-1',
      name: 'read',
      input: { path: '/test' },
    })
    expect(response.stopReason).toBe('tool_use')
  })

  it('generates tool ID if not provided', () => {
    const response = createToolUseResponse('bash', { command: 'ls' })

    expect((response.content[0] as any).id).toMatch(/^tool-/)
  })
})
