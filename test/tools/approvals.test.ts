import { describe, it, expect, vi } from 'vitest'
import {
  ApprovalManager,
  createAutoApproveManager,
  createDenyAllManager,
  createInteractiveManager,
} from '../../src/tools/approvals.js'
import type { ApprovalRequest, ToolContext } from '../../src/tools/types.js'

const createRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'test-approval-id',
  tool: 'test_tool',
  action: 'test_action',
  ...overrides,
})

const createMockContext = (): ToolContext => ({
  sessionId: 'test-session',
  requestId: 'test-request',
  approvals: [],
  audit: {
    log: vi.fn(),
  } as any,
  sandbox: {} as any,
  workDir: '/tmp',
})

describe('ApprovalManager', () => {
  describe('createAutoApproveManager', () => {
    it('approves all requests', async () => {
      const manager = createAutoApproveManager()
      const context = createMockContext()

      const result = await manager.request(createRequest(), context)

      expect(result).toBe(true)
    })

    it('approves requests with any tool', async () => {
      const manager = createAutoApproveManager()
      const context = createMockContext()

      const results = await Promise.all([
        manager.request(createRequest({ tool: 'bash' }), context),
        manager.request(createRequest({ tool: 'write' }), context),
        manager.request(createRequest({ tool: 'web_fetch' }), context),
      ])

      expect(results).toEqual([true, true, true])
    })
  })

  describe('createDenyAllManager', () => {
    it('denies all requests', async () => {
      const manager = createDenyAllManager()
      const context = createMockContext()

      const result = await manager.request(createRequest(), context)

      expect(result).toBe(false)
    })

    it('denies requests with any tool', async () => {
      const manager = createDenyAllManager()
      const context = createMockContext()

      const results = await Promise.all([
        manager.request(createRequest({ tool: 'read' }), context),
        manager.request(createRequest({ tool: 'bash' }), context),
      ])

      expect(results).toEqual([false, false])
    })
  })

  describe('createInteractiveManager', () => {
    it('calls promptFn with formatted message', async () => {
      const promptFn = vi.fn().mockResolvedValue(true)
      const manager = createInteractiveManager(promptFn)
      const context = createMockContext()

      await manager.request(createRequest({ tool: 'bash', action: 'execute' }), context)

      expect(promptFn).toHaveBeenCalled()
      const message = promptFn.mock.calls[0][0]
      expect(message).toContain('bash')
      expect(message).toContain('execute')
    })

    it('returns promptFn result', async () => {
      const approvePromptFn = vi.fn().mockResolvedValue(true)
      const denyPromptFn = vi.fn().mockResolvedValue(false)

      const approveManager = createInteractiveManager(approvePromptFn)
      const denyManager = createInteractiveManager(denyPromptFn)
      const context = createMockContext()

      expect(await approveManager.request(createRequest(), context)).toBe(true)
      expect(await denyManager.request(createRequest(), context)).toBe(false)
    })

    it('handles async promptFn', async () => {
      const promptFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return true
      })
      const manager = createInteractiveManager(promptFn)
      const context = createMockContext()

      const result = await manager.request(createRequest(), context)

      expect(result).toBe(true)
    })
  })

  describe('ApprovalManager class', () => {
    it('constructs with callback', () => {
      const callback = vi.fn()
      const manager = new ApprovalManager(callback)

      expect(manager).toBeDefined()
    })

    it('calls callback on request', async () => {
      const callback = vi.fn().mockResolvedValue(true)
      const manager = new ApprovalManager(callback)
      const context = createMockContext()

      const request = createRequest()
      await manager.request(request, context)

      expect(callback).toHaveBeenCalledWith(request)
    })

    it('defaults to auto-approve without callback', async () => {
      const manager = new ApprovalManager()
      const context = createMockContext()

      const result = await manager.request(createRequest(), context)

      expect(result).toBe(true)
    })
  })

  describe('hasApproval', () => {
    it('returns true if approval exists in context', () => {
      const manager = new ApprovalManager()
      const context = createMockContext()
      context.approvals = ['existing-approval']

      expect(manager.hasApproval(context, 'existing-approval')).toBe(true)
    })

    it('returns false if approval does not exist', () => {
      const manager = new ApprovalManager()
      const context = createMockContext()

      expect(manager.hasApproval(context, 'nonexistent')).toBe(false)
    })
  })

  describe('addApproval', () => {
    it('adds approval to context', () => {
      const manager = new ApprovalManager()
      const context = createMockContext()

      manager.addApproval(context, 'new-approval')

      expect(context.approvals).toContain('new-approval')
    })

    it('does not duplicate approvals', () => {
      const manager = new ApprovalManager()
      const context = createMockContext()

      manager.addApproval(context, 'approval')
      manager.addApproval(context, 'approval')

      expect(context.approvals.filter((a) => a === 'approval')).toHaveLength(1)
    })
  })
})
