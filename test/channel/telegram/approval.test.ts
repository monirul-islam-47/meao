import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TelegramApprovalUI } from '../../../src/channel/telegram/approval.js'
import type { ApprovalRequestMessage } from '../../../src/channel/types.js'

// Mock Telegraf types
interface MockBot {
  telegram: {
    sendMessage: ReturnType<typeof vi.fn>
    editMessageText: ReturnType<typeof vi.fn>
  }
}

describe('TelegramApprovalUI', () => {
  let approvalUI: TelegramApprovalUI
  let mockBot: MockBot
  let messageId: number

  beforeEach(() => {
    approvalUI = new TelegramApprovalUI(100) // Very short timeout for tests
    messageId = 12345

    mockBot = {
      telegram: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: messageId }),
        editMessageText: vi.fn().mockResolvedValue(undefined),
      },
    }
  })

  afterEach(() => {
    approvalUI.cancelAll()
  })

  function createApprovalRequest(overrides: Partial<ApprovalRequestMessage> = {}): ApprovalRequestMessage {
    return {
      type: 'approval_request',
      id: 'msg-1',
      timestamp: new Date(),
      sessionId: 'session-1',
      approvalId: 'approval-1',
      tool: 'bash',
      action: 'execute command',
      target: 'rm -rf /tmp/test',
      reason: 'Requested by user',
      isDangerous: true,
      ...overrides,
    }
  }

  describe('formatApprovalRequest (via showApproval)', () => {
    it('calls sendMessage with approval content', async () => {
      const request = createApprovalRequest()
      const chatId = 100

      // Start approval (will timeout quickly)
      const approvalPromise = approvalUI.showApproval(mockBot as any, chatId, request)

      // Wait a tick for sendMessage to be called
      await new Promise(resolve => setTimeout(resolve, 10))

      // Verify message was sent
      expect(mockBot.telegram.sendMessage).toHaveBeenCalled()
      const call = mockBot.telegram.sendMessage.mock.calls[0]

      expect(call[0]).toBe(chatId)
      expect(call[1]).toContain('Approval Required')
      expect(call[1]).toContain('bash')
      expect(call[2].parse_mode).toBe('Markdown')
      expect(call[2].reply_markup.inline_keyboard).toBeDefined()

      // Let it timeout
      const response = await approvalPromise
      expect(response.approved).toBe(false)
    })

    it('includes tool name in approval message', async () => {
      const request = createApprovalRequest({ tool: 'web_fetch' })

      const approvalPromise = approvalUI.showApproval(mockBot as any, 100, request)
      await new Promise(resolve => setTimeout(resolve, 10))

      const call = mockBot.telegram.sendMessage.mock.calls[0]
      expect(call[1]).toContain('web_fetch')

      await approvalPromise
    })

    it('shows danger warning for dangerous actions', async () => {
      const request = createApprovalRequest({ isDangerous: true })

      const approvalPromise = approvalUI.showApproval(mockBot as any, 100, request)
      await new Promise(resolve => setTimeout(resolve, 10))

      const call = mockBot.telegram.sendMessage.mock.calls[0]
      expect(call[1]).toContain('dangerous')

      await approvalPromise
    })

    it('includes inline keyboard with Allow/Deny buttons', async () => {
      const request = createApprovalRequest()

      const approvalPromise = approvalUI.showApproval(mockBot as any, 100, request)
      await new Promise(resolve => setTimeout(resolve, 10))

      const call = mockBot.telegram.sendMessage.mock.calls[0]
      const keyboard = call[2].reply_markup.inline_keyboard

      // First row should have Allow/Deny
      const buttons = keyboard[0]
      expect(buttons.some((b: any) => b.text === 'Allow')).toBe(true)
      expect(buttons.some((b: any) => b.text === 'Deny')).toBe(true)

      await approvalPromise
    })
  })

  describe('timeout', () => {
    it('resolves with denied after timeout', async () => {
      const request = createApprovalRequest()

      const start = Date.now()
      const response = await approvalUI.showApproval(mockBot as any, 100, request)
      const elapsed = Date.now() - start

      expect(response.approved).toBe(false)
      expect(elapsed).toBeGreaterThanOrEqual(100) // Timeout was 100ms
      expect(elapsed).toBeLessThan(500) // But not too long
    })

    it('updates message on timeout', async () => {
      const request = createApprovalRequest()

      await approvalUI.showApproval(mockBot as any, 100, request)

      expect(mockBot.telegram.editMessageText).toHaveBeenCalledWith(
        100,
        messageId,
        undefined,
        'Approval timed out',
        expect.any(Object)
      )
    })
  })

  describe('handleCallback', () => {
    it('returns null for non-approval callbacks', async () => {
      const ctx = {
        callbackQuery: { data: 'other:action' },
        answerCbQuery: vi.fn(),
      }

      const result = await approvalUI.handleCallback(ctx as any, mockBot as any)
      expect(result).toBeNull()
    })

    it('handles expired approval', async () => {
      const ctx = {
        callbackQuery: { data: 'approve:nonexistent:yes' },
        answerCbQuery: vi.fn(),
      }

      const result = await approvalUI.handleCallback(ctx as any, mockBot as any)

      expect(result).toBeNull()
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('This approval has expired.')
    })
  })

  describe('hasPending', () => {
    it('returns false when no pending approvals', () => {
      expect(approvalUI.hasPending()).toBe(false)
    })
  })

  describe('cancelAll', () => {
    it('resolves pending approvals with denial', async () => {
      const request = createApprovalRequest()

      // Use longer timeout so we can cancel before it times out
      const longTimeoutUI = new TelegramApprovalUI(10000)
      const promise = longTimeoutUI.showApproval(mockBot as any, 100, request)

      // Wait for setup
      await new Promise(resolve => setTimeout(resolve, 10))

      // Cancel
      longTimeoutUI.cancelAll()

      const response = await promise
      expect(response.approved).toBe(false)
    })
  })
})
