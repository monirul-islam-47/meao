/**
 * WebSocket channel implementation
 */

import type { WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import type { ServerMessage } from '../types.js'

interface PendingApproval {
  resolve: (approved: boolean) => void
  timeout: NodeJS.Timeout
}

/**
 * WebSocket channel for real-time streaming.
 */
export class WebSocketChannel {
  private socket: WebSocket
  private pendingApprovals = new Map<string, PendingApproval>()

  constructor(socket: WebSocket) {
    this.socket = socket
  }

  /**
   * Send a message to the client.
   */
  send(message: ServerMessage): void {
    if (this.socket.readyState === 1) { // WebSocket.OPEN
      this.socket.send(JSON.stringify(message))
    }
  }

  /**
   * Stream text delta.
   */
  streamDelta(delta: string): void {
    this.send({ type: 'text_delta', delta })
  }

  /**
   * Notify tool call start.
   */
  onToolCallStart(id: string, name: string): void {
    this.send({ type: 'tool_call_start', id, name })
  }

  /**
   * Notify tool call result.
   */
  onToolCallResult(id: string, name: string, success: boolean): void {
    this.send({ type: 'tool_call_result', id, name, success })
  }

  /**
   * Request approval via WebSocket.
   * Waits for client response or times out after 30 seconds.
   */
  requestApproval(tool: string, action: string, reason: string): Promise<boolean> {
    const requestId = randomUUID()

    return new Promise((resolve) => {
      // Set timeout (30 seconds)
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId)
        resolve(false) // Timeout = denied
      }, 30000)

      this.pendingApprovals.set(requestId, { resolve, timeout })

      // Send approval request
      this.send({
        type: 'approval_request',
        requestId,
        tool,
        action,
        reason,
      })
    })
  }

  /**
   * Resolve a pending approval.
   */
  resolveApproval(requestId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingApprovals.delete(requestId)
      pending.resolve(approved)
    }
  }

  /**
   * Cancel all pending approvals (on disconnect).
   */
  cancelAllPendingApprovals(): void {
    for (const [, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout)
      pending.resolve(false) // Deny on disconnect
    }
    this.pendingApprovals.clear()
  }

  /**
   * Check if socket is open.
   */
  isOpen(): boolean {
    return this.socket.readyState === 1 // WebSocket.OPEN
  }
}
