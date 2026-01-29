import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Telegraf to avoid actual network calls - must be before imports
const mockBot = {
  launch: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  telegram: {
    setWebhook: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    getFile: vi.fn().mockResolvedValue({ file_path: 'photos/test.jpg' }),
  },
  on: vi.fn(),
  command: vi.fn(),
  catch: vi.fn(),
}

vi.mock('telegraf', () => ({
  Telegraf: vi.fn(() => mockBot),
}))

// Import after mock
import { TelegramChannel, type TelegramChannelConfig } from '../../../src/channel/telegram/index.js'

describe('TelegramChannel', () => {
  const OWNER_ID = 'owner-123'
  const OWNER_UUID = '550e8400-e29b-41d4-a716-446655440000'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createConfig(overrides: Partial<TelegramChannelConfig> = {}): TelegramChannelConfig {
    return {
      token: 'test-token',
      ownerId: OWNER_ID,
      ownerUuid: OWNER_UUID,
      dmPolicy: 'owner_only',
      rateLimit: { messagesPerMinute: 10, messagesPerHour: 100 },
      ...overrides,
    }
  }

  describe('isAuthorized', () => {
    describe('owner_only mode', () => {
      it('allows owner', () => {
        const channel = new TelegramChannel(createConfig({ dmPolicy: 'owner_only' }))
        expect(channel.isAuthorized(OWNER_ID)).toBe(true)
      })

      it('rejects non-owner', () => {
        const channel = new TelegramChannel(createConfig({ dmPolicy: 'owner_only' }))
        expect(channel.isAuthorized('other-user')).toBe(false)
      })
    })

    describe('allowlist mode', () => {
      it('allows owner', () => {
        const channel = new TelegramChannel(
          createConfig({
            dmPolicy: 'allowlist',
            allowedUsers: ['friend-456'],
          })
        )
        expect(channel.isAuthorized(OWNER_ID)).toBe(true)
      })

      it('allows allowlisted users', () => {
        const channel = new TelegramChannel(
          createConfig({
            dmPolicy: 'allowlist',
            allowedUsers: ['friend-456', 'friend-789'],
          })
        )
        expect(channel.isAuthorized('friend-456')).toBe(true)
        expect(channel.isAuthorized('friend-789')).toBe(true)
      })

      it('rejects non-allowlisted users', () => {
        const channel = new TelegramChannel(
          createConfig({
            dmPolicy: 'allowlist',
            allowedUsers: ['friend-456'],
          })
        )
        expect(channel.isAuthorized('stranger-999')).toBe(false)
      })
    })

    describe('anyone mode', () => {
      it('allows anyone', () => {
        const channel = new TelegramChannel(createConfig({ dmPolicy: 'anyone' }))
        expect(channel.isAuthorized('random-user')).toBe(true)
        expect(channel.isAuthorized(OWNER_ID)).toBe(true)
      })
    })
  })

  describe('mapTelegramToUserId', () => {
    it('maps owner Telegram ID to ownerUuid', () => {
      const channel = new TelegramChannel(createConfig())
      expect(channel.mapTelegramToUserId(OWNER_ID)).toBe(OWNER_UUID)
    })

    it('maps other users to telegram-prefixed ID', () => {
      const channel = new TelegramChannel(createConfig())
      expect(channel.mapTelegramToUserId('other-456')).toBe('telegram:other-456')
    })
  })

  describe('connect', () => {
    it('uses polling mode when no webhook URL', async () => {
      const channel = new TelegramChannel(createConfig())
      await channel.connect()

      const bot = channel.getBot()
      expect(bot.launch).toHaveBeenCalled()
      expect(channel.state).toBe('connected')
    })

    it('uses webhook mode when webhook URL provided', async () => {
      const channel = new TelegramChannel(
        createConfig({ webhookUrl: 'https://example.com/webhook' })
      )
      await channel.connect()

      const bot = channel.getBot()
      expect(bot.telegram.setWebhook).toHaveBeenCalledWith('https://example.com/webhook')
      expect(channel.state).toBe('connected')
    })
  })

  describe('disconnect', () => {
    it('stops the bot', async () => {
      const channel = new TelegramChannel(createConfig())
      await channel.connect()
      await channel.disconnect()

      const bot = channel.getBot()
      expect(bot.stop).toHaveBeenCalledWith('SIGTERM')
      expect(channel.state).toBe('disconnected')
    })
  })

  describe('send', () => {
    it('sends assistant message', async () => {
      const channel = new TelegramChannel(createConfig())

      // Simulate having an active chat context
      // This is normally set during message handling
      ;(channel as any).currentChatId = 12345

      await channel.send({
        type: 'assistant_message',
        id: 'msg-1',
        timestamp: new Date(),
        sessionId: 'session-1',
        content: 'Hello, world!',
      })

      const bot = channel.getBot()
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        12345,
        'Hello, world!',
        expect.objectContaining({ parse_mode: 'Markdown' })
      )
    })

    it('ignores messages when no active chat', async () => {
      const channel = new TelegramChannel(createConfig())

      // No currentChatId set
      await channel.send({
        type: 'assistant_message',
        id: 'msg-1',
        timestamp: new Date(),
        sessionId: 'session-1',
        content: 'Hello!',
      })

      const bot = channel.getBot()
      expect(bot.telegram.sendMessage).not.toHaveBeenCalled()
    })

    it('sends error messages', async () => {
      const channel = new TelegramChannel(createConfig())
      ;(channel as any).currentChatId = 12345

      await channel.send({
        type: 'error',
        id: 'err-1',
        timestamp: new Date(),
        sessionId: 'session-1',
        code: 'test_error',
        message: 'Something went wrong',
        recoverable: true,
      })

      const bot = channel.getBot()
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        12345,
        'Error: Something went wrong',
        expect.objectContaining({ parse_mode: 'Markdown' })
      )
    })
  })

  describe('streaming', () => {
    it('buffers stream deltas', async () => {
      vi.useFakeTimers()
      const channel = new TelegramChannel(createConfig())
      ;(channel as any).currentChatId = 12345

      // Start stream
      await channel.send({
        type: 'stream_start',
        id: 'stream-1',
        timestamp: new Date(),
        sessionId: 'session-1',
        streamId: 'stream-1',
      })

      // Send deltas
      await channel.send({
        type: 'stream_delta',
        id: 'delta-1',
        timestamp: new Date(),
        sessionId: 'session-1',
        streamId: 'stream-1',
        delta: 'Hello',
      })

      await channel.send({
        type: 'stream_delta',
        id: 'delta-2',
        timestamp: new Date(),
        sessionId: 'session-1',
        streamId: 'stream-1',
        delta: ' world',
      })

      // Advance time to trigger update
      vi.advanceTimersByTime(600)

      // End stream
      await channel.send({
        type: 'stream_end',
        id: 'end-1',
        timestamp: new Date(),
        sessionId: 'session-1',
        streamId: 'stream-1',
      })

      const bot = channel.getBot()
      // Should have sent at least one message
      expect(bot.telegram.sendMessage).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('state management', () => {
    it('starts in disconnected state', () => {
      const channel = new TelegramChannel(createConfig())
      expect(channel.state).toBe('disconnected')
    })

    it('transitions to connecting then connected', async () => {
      const channel = new TelegramChannel(createConfig())
      const states: string[] = []

      channel.on('stateChange', (state) => states.push(state))

      await channel.connect()

      expect(states).toContain('connecting')
      expect(states).toContain('connected')
    })
  })

  describe('session management', () => {
    it('generates a session ID', () => {
      const channel = new TelegramChannel(createConfig())
      expect(channel.sessionId).toBeDefined()
      expect(typeof channel.sessionId).toBe('string')
      expect(channel.sessionId.length).toBeGreaterThan(0)
    })
  })
})
