/**
 * Authentication middleware for gateway
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import type { TokenStore } from './tokens.js'

/**
 * Options for auth middleware.
 */
export interface AuthMiddlewareOptions {
  /** Gateway is configured for localhost (auto-auth as owner) */
  isLocalhostGateway?: boolean
}

/**
 * Create auth middleware.
 *
 * For localhost (127.0.0.1), auto-authenticates as owner.
 * For remote connections, requires Bearer token.
 */
export function createAuthMiddleware(
  tokenStore: TokenStore,
  options: AuthMiddlewareOptions = {}
) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Skip auth for health endpoints
    if (request.url.startsWith('/health') || request.url === '/ready') {
      return
    }

    // Check if localhost (IP-based or gateway config)
    const isLocalhost =
      options.isLocalhostGateway ||
      request.ip === '127.0.0.1' ||
      request.ip === '::1' ||
      request.ip === '::ffff:127.0.0.1'

    if (isLocalhost) {
      // Auto-authenticate as owner for localhost
      request.user = { id: 'local-owner', role: 'owner' }
      return
    }

    // For pairing request endpoint only - no auth needed (new device requests code)
    // Verify endpoint needs owner auth (handled by having user set above for localhost)
    if (request.url === '/auth/pair/request') {
      return
    }

    // For remote connections, require Bearer token
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Authentication required',
        message: 'Provide a Bearer token or connect from localhost',
      })
    }

    const token = authHeader.slice(7) // Remove 'Bearer '
    const tokenInfo = await tokenStore.verify(token)

    if (!tokenInfo) {
      return reply.status(401).send({
        error: 'Invalid token',
        message: 'Token is invalid or expired',
      })
    }

    request.user = {
      id: tokenInfo.userId,
      role: tokenInfo.role,
    }
  }
}

/**
 * Require owner role for sensitive operations.
 */
export function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (!request.user || request.user.role !== 'owner') {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Owner access required',
    })
  }
}
