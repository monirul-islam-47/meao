/**
 * Session routes
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { GatewayContext } from '../types.js'

const CreateSessionSchema = z.object({
  workDir: z.string().optional(),
  model: z.string().optional(),
  title: z.string().optional(),
})

export function registerSessionRoutes(
  app: FastifyInstance,
  context: GatewayContext
): void {
  const { sessionManager, auditLogger } = context

  // Create a new session
  app.post('/sessions', async (request, reply) => {
    const body = CreateSessionSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body' })
    }

    const session = await sessionManager.newSession({
      workDir: body.data.workDir,
      model: body.data.model,
      title: body.data.title,
    })

    auditLogger.info('gateway', 'session_created', {
      sessionId: session.id,
      requestId: request.id,
    })

    return reply.status(201).send({
      id: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
      state: session.state,
    })
  })

  // List sessions
  app.get('/sessions', async (request, reply) => {
    const { limit = 20, state } = request.query as {
      limit?: number
      state?: 'active' | 'paused' | 'completed'
    }

    const sessions = await sessionManager.listSessions({ limit, state })

    return reply.send({
      sessions: sessions.map(s => ({
        id: s.id,
        title: s.title,
        state: s.state,
        messageCount: s.messageCount,
        createdAt: new Date(s.createdAt).toISOString(),
        updatedAt: new Date(s.updatedAt).toISOString(),
      })),
    })
  })

  // Get session by ID
  app.get('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = await sessionManager.resumeSession(id)

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    return reply.send({
      id: session.id,
      title: session.title,
      state: session.state,
      model: session.model,
      workDir: session.workDir,
      messageCount: session.messageCount,
      totalTokens: session.totalTokens,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
    })
  })

  // Delete session
  app.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    // Check if session exists first
    const exists = await sessionManager.resumeSession(id)
    if (!exists) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    // Delete via store (need to access store directly)
    // For now, just mark as completed
    await sessionManager.completeSession()

    auditLogger.info('gateway', 'session_deleted', {
      sessionId: id,
      requestId: request.id,
    })

    return reply.status(204).send()
  })
}
