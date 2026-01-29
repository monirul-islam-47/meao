/**
 * Health check routes
 */

import type { FastifyInstance } from 'fastify'
import type { GatewayContext } from '../types.js'

export function registerHealthRoutes(
  app: FastifyInstance,
  _context: GatewayContext
): void {
  // Basic health check
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  })

  // Detailed health check
  app.get('/health/detailed', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.0.1',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    }
  })

  // Readiness probe
  app.get('/ready', async () => {
    return { ready: true }
  })
}
