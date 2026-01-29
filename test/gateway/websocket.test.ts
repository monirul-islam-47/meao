/**
 * Tests for WebSocket channel
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocketChannel } from '../../src/gateway/websocket/channel.js'
import type { WebSocket } from 'ws'

function createMockSocket(): { socket: WebSocket; messages: string[] } {
  const messages: string[] = []
  const socket = {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn((data: string) => messages.push(data)),
    close: vi.fn(),
  } as unknown as WebSocket

  return { socket, messages }
}

describe('WebSocketChannel', () => {
  describe('send', () => {
    it('sends JSON messages', () => {
      const { socket, messages } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      channel.send({ type: 'pong' })

      expect(messages).toHaveLength(1)
      expect(JSON.parse(messages[0])).toEqual({ type: 'pong' })
    })

    it('does not send when socket is closed', () => {
      const { socket, messages } = createMockSocket()
      ;(socket as any).readyState = 3 // WebSocket.CLOSED
      const channel = new WebSocketChannel(socket)

      channel.send({ type: 'pong' })

      expect(messages).toHaveLength(0)
    })
  })

  describe('streamDelta', () => {
    it('sends text delta events', () => {
      const { socket, messages } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      channel.streamDelta('Hello ')
      channel.streamDelta('World')

      expect(messages).toHaveLength(2)
      expect(JSON.parse(messages[0])).toEqual({ type: 'text_delta', delta: 'Hello ' })
      expect(JSON.parse(messages[1])).toEqual({ type: 'text_delta', delta: 'World' })
    })
  })

  describe('onToolCallStart', () => {
    it('sends tool call start event', () => {
      const { socket, messages } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      channel.onToolCallStart('call-123', 'bash')

      expect(messages).toHaveLength(1)
      expect(JSON.parse(messages[0])).toEqual({
        type: 'tool_call_start',
        id: 'call-123',
        name: 'bash',
      })
    })
  })

  describe('onToolCallResult', () => {
    it('sends tool call result event', () => {
      const { socket, messages } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      channel.onToolCallResult('call-123', 'bash', true)

      expect(messages).toHaveLength(1)
      expect(JSON.parse(messages[0])).toEqual({
        type: 'tool_call_result',
        id: 'call-123',
        name: 'bash',
        success: true,
      })
    })
  })

  describe('requestApproval', () => {
    it('sends approval request and waits for response', async () => {
      const { socket, messages } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      const approvalPromise = channel.requestApproval('bash', 'execute', 'Run command')

      // Check request was sent
      expect(messages).toHaveLength(1)
      const request = JSON.parse(messages[0])
      expect(request.type).toBe('approval_request')
      expect(request.tool).toBe('bash')
      expect(request.action).toBe('execute')
      expect(request.reason).toBe('Run command')
      expect(request.requestId).toBeDefined()

      // Simulate approval
      channel.resolveApproval(request.requestId, true)

      const result = await approvalPromise
      expect(result).toBe(true)
    })

    it('returns false on denial', async () => {
      const { socket, messages } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      const approvalPromise = channel.requestApproval('bash', 'execute', 'Run command')

      const request = JSON.parse(messages[0])
      channel.resolveApproval(request.requestId, false)

      const result = await approvalPromise
      expect(result).toBe(false)
    })

    it('times out after 30 seconds', async () => {
      vi.useFakeTimers()
      const { socket } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      const approvalPromise = channel.requestApproval('bash', 'execute', 'Run command')

      // Fast-forward 31 seconds
      vi.advanceTimersByTime(31000)

      const result = await approvalPromise
      expect(result).toBe(false) // Timeout = denied

      vi.useRealTimers()
    })

    it('ignores resolve for unknown request', () => {
      const { socket } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      // Should not throw
      channel.resolveApproval('unknown-id', true)
    })
  })

  describe('cancelAllPendingApprovals', () => {
    it('denies all pending approvals', async () => {
      const { socket } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      const approval1 = channel.requestApproval('bash', 'exec', 'reason1')
      const approval2 = channel.requestApproval('write', 'create', 'reason2')

      channel.cancelAllPendingApprovals()

      const [result1, result2] = await Promise.all([approval1, approval2])
      expect(result1).toBe(false)
      expect(result2).toBe(false)
    })
  })

  describe('isOpen', () => {
    it('returns true when socket is open', () => {
      const { socket } = createMockSocket()
      const channel = new WebSocketChannel(socket)

      expect(channel.isOpen()).toBe(true)
    })

    it('returns false when socket is closed', () => {
      const { socket } = createMockSocket()
      ;(socket as any).readyState = 3 // WebSocket.CLOSED
      const channel = new WebSocketChannel(socket)

      expect(channel.isOpen()).toBe(false)
    })
  })
})
