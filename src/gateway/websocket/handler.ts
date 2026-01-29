/**
 * WebSocket handler for real-time streaming
 */

import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import type { GatewayContext, ClientMessage, ServerMessage } from '../types.js'
import { WebSocketChannel } from './channel.js'

/**
 * Register WebSocket route.
 */
export function registerWebSocket(
  app: FastifyInstance,
  context: GatewayContext
): void {
  const { orchestrator, sessionManager, auditLogger } = context

  app.get('/ws', { websocket: true }, (connection, request) => {
    const socket = connection
    const userId = request.user?.id ?? 'anonymous'
    const requestId = request.id

    auditLogger.info('gateway', 'ws_connected', { userId, requestId })

    // Create WebSocket channel for streaming
    const channel = new WebSocketChannel(socket as unknown as WebSocket)

    // Track current session
    let currentSessionId: string | null = null

    socket.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString())

        switch (message.type) {
          case 'message': {
            // Get or resume session
            if (message.sessionId !== currentSessionId) {
              const session = await sessionManager.resumeSession(message.sessionId)
              if (!session) {
                channel.send({
                  type: 'error',
                  message: 'Session not found',
                  code: 'SESSION_NOT_FOUND',
                })
                return
              }
              currentSessionId = message.sessionId
            }

            // Persist user message
            await sessionManager.addUserMessage(message.content)

            // Process with orchestrator
            await orchestrator.processMessage(message.content)

            // Send completion
            channel.send({ type: 'message_complete' })
            break
          }

          case 'approval_response': {
            channel.resolveApproval(message.requestId, message.approved)
            break
          }

          case 'ping': {
            channel.send({ type: 'pong' })
            break
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        channel.send({
          type: 'error',
          message: errorMessage,
        })
        auditLogger.info('gateway', 'ws_error', {
          userId,
          error: errorMessage,
          requestId,
        })
      }
    })

    socket.on('close', () => {
      channel.cancelAllPendingApprovals()
      auditLogger.info('gateway', 'ws_disconnected', { userId, requestId })
    })

    socket.on('error', (error) => {
      auditLogger.info('gateway', 'ws_error', {
        userId,
        error: error.message,
        requestId,
      })
    })
  })
}
