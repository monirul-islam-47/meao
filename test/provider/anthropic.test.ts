import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AnthropicProvider,
  createAnthropicProvider,
} from '../../src/provider/anthropic.js'
import { ProviderError } from '../../src/provider/types.js'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider

  beforeEach(() => {
    provider = new AnthropicProvider({
      apiKey: 'test-api-key',
      timeout: 5000,
      maxRetries: 1,
    })
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('basic functionality', () => {
    it('has correct name', () => {
      expect(provider.name).toBe('anthropic')
    })

    it('isAvailable returns true with API key', () => {
      expect(provider.isAvailable()).toBe(true)
    })

    it('countTokens approximates token count', () => {
      const tokens = provider.countTokens('Hello, world!')
      expect(tokens).toBeGreaterThan(0)
    })
  })

  describe('createMessage', () => {
    it('makes correct API request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'msg_123',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'Hello!' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      })

      await provider.createMessage(
        [{ role: 'user', content: 'Hi' }],
        { model: 'claude-sonnet-4-20250514', maxTokens: 1000 }
      )

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key',
            'anthropic-version': '2023-06-01',
          }),
        })
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('claude-sonnet-4-20250514')
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }])
      expect(body.max_tokens).toBe(1000)
    })

    it('parses response correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'msg_123',
            model: 'claude-sonnet-4-20250514',
            content: [
              { type: 'text', text: 'Hello!' },
              { type: 'tool_use', id: 'tool_1', name: 'read', input: { path: '/test' } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 15 },
          }),
      })

      const response = await provider.createMessage(
        [{ role: 'user', content: 'test' }],
        { model: 'test' }
      )

      expect(response.id).toBe('msg_123')
      expect(response.content).toHaveLength(2)
      expect(response.content[0]).toEqual({ type: 'text', text: 'Hello!' })
      expect(response.content[1]).toEqual({
        type: 'tool_use',
        id: 'tool_1',
        name: 'read',
        input: { path: '/test' },
      })
      expect(response.stopReason).toBe('tool_use')
      expect(response.usage.inputTokens).toBe(10)
      expect(response.usage.outputTokens).toBe(15)
    })

    it('includes system prompt when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'msg_123',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'Response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      })

      await provider.createMessage([{ role: 'user', content: 'Hi' }], {
        model: 'test',
        system: 'You are a helpful assistant.',
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.system).toBe('You are a helpful assistant.')
    })

    it('includes tools when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'msg_123',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'Response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      })

      await provider.createMessage([{ role: 'user', content: 'Hi' }], {
        model: 'test',
        tools: [
          {
            name: 'read',
            description: 'Read a file',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.tools).toHaveLength(1)
      expect(body.tools[0].name).toBe('read')
    })
  })

  describe('error handling', () => {
    it('throws ProviderError on authentication error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: { type: 'authentication_error', message: 'Invalid API key' },
          }),
      })

      await expect(
        provider.createMessage([{ role: 'user', content: 'test' }], {
          model: 'test',
        })
      ).rejects.toThrow(ProviderError)

      try {
        await provider.createMessage([{ role: 'user', content: 'test' }], {
          model: 'test',
        })
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError)
        expect((error as ProviderError).code).toBe('authentication_error')
        expect((error as ProviderError).retryable).toBe(false)
      }
    })

    it('retries on rate limit error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([['retry-after', '1']]),
          json: () =>
            Promise.resolve({
              error: { type: 'rate_limit_error', message: 'Rate limited' },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg_123',
              model: 'test',
              content: [{ type: 'text', text: 'Success' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 5 },
            }),
        })

      const response = await provider.createMessage(
        [{ role: 'user', content: 'test' }],
        { model: 'test' }
      )

      expect(response.content[0]).toEqual({ type: 'text', text: 'Success' })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws ProviderError on timeout', async () => {
      mockFetch.mockImplementation(() => {
        const error = new Error('Aborted')
        error.name = 'AbortError'
        throw error
      })

      await expect(
        provider.createMessage([{ role: 'user', content: 'test' }], {
          model: 'test',
        })
      ).rejects.toThrow(ProviderError)

      try {
        await provider.createMessage([{ role: 'user', content: 'test' }], {
          model: 'test',
        })
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError)
        expect((error as ProviderError).code).toBe('timeout_error')
      }
    })
  })
})

describe('createAnthropicProvider', () => {
  it('throws without API key', () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    expect(() => createAnthropicProvider()).toThrow(/api key/i)

    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv
    }
  })

  it('uses environment API key', () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'env-api-key'

    const provider = createAnthropicProvider()
    expect(provider.isAvailable()).toBe(true)

    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('prefers provided API key over environment', () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'env-api-key'

    const provider = createAnthropicProvider({ apiKey: 'provided-key' })
    expect(provider.isAvailable()).toBe(true)

    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
  })
})
