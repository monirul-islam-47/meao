/**
 * Gateway HTTP server
 */

import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { randomUUID } from 'crypto'
import type { GatewayConfig, GatewayContext } from './types.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerWebSocket } from './websocket/handler.js'

/**
 * Create and configure the gateway server.
 */
export async function createGateway(
  config: GatewayConfig,
  context: GatewayContext
): Promise<FastifyInstance> {
  // Use simple logger in test/production, pretty in development
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST
  const isDev = process.env.NODE_ENV === 'development'

  const app = Fastify({
    logger: isTest
      ? false
      : isDev
        ? { level: 'info' }
        : { level: 'info' },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  })

  // Register WebSocket plugin
  await app.register(websocket)

  // Request correlation
  app.addHook('preHandler', async (request, reply) => {
    // For localhost, auto-authenticate as owner
    if (config.host === '127.0.0.1' || config.host === 'localhost') {
      request.user = { id: 'local-owner', role: 'owner' }
    }

    // Add request ID to reply headers
    reply.header('x-request-id', request.id)
  })

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)

    const statusCode = error.statusCode ?? 500
    const message = statusCode === 500 ? 'Internal server error' : error.message

    context.auditLogger.info('gateway', 'error', {
      requestId: request.id,
      error: message,
      statusCode,
    })

    return reply.status(statusCode).send({
      error: message,
      requestId: request.id,
    })
  })

  // Register routes
  registerHealthRoutes(app, context)
  registerSessionRoutes(app, context)
  registerWebSocket(app, context)

  return app
}

/**
 * Start the gateway server.
 */
export async function startGateway(
  config: GatewayConfig,
  context: GatewayContext
): Promise<FastifyInstance> {
  const app = await createGateway(config, context)

  try {
    await app.listen({ host: config.host, port: config.port })
    console.log(`Gateway listening on http://${config.host}:${config.port}`)
    return app
  } catch (err) {
    app.log.error(err)
    throw err
  }
}
