/**
 * Authentication routes
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DevicePairing } from '../auth/pairing.js'
import type { TokenStore } from '../auth/tokens.js'
import type { GatewayContext } from '../types.js'

const GenerateCodeSchema = z.object({
  deviceName: z.string().min(1).max(50),
})

const VerifyCodeSchema = z.object({
  code: z.string().length(6),
})

export interface AuthRoutesContext {
  pairing: DevicePairing
  tokenStore: TokenStore
  auditLogger: GatewayContext['auditLogger']
}

export function registerAuthRoutes(
  app: FastifyInstance,
  ctx: AuthRoutesContext
): void {
  const { pairing, tokenStore, auditLogger } = ctx

  // Generate a pairing code (called from new device)
  app.post('/auth/pair/request', async (request, reply) => {
    const body = GenerateCodeSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request: deviceName required' })
    }

    // Rate limit: max 10 pending codes
    if (pairing.getPendingCount() >= 10) {
      return reply.status(429).send({ error: 'Too many pending pairing requests' })
    }

    const code = pairing.generateCode(body.data.deviceName)

    auditLogger.info('gateway', 'pairing_requested', {
      deviceName: body.data.deviceName,
      requestId: request.id,
    })

    return reply.status(201).send({
      code,
      expiresIn: 300, // 5 minutes
      message: 'Enter this code on the owner device to complete pairing',
    })
  })

  // Verify a pairing code (called from owner device)
  app.post('/auth/pair/verify', async (request, reply) => {
    // Only owner can verify codes
    if (!request.user || request.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Owner access required' })
    }

    const body = VerifyCodeSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request: 6-character code required' })
    }

    const result = await pairing.verifyCode(body.data.code)

    if (!result.success) {
      auditLogger.info('gateway', 'pairing_failed', {
        error: result.error,
        requestId: request.id,
      })
      return reply.status(400).send({ error: result.error })
    }

    auditLogger.info('gateway', 'pairing_completed', {
      requestId: request.id,
    })

    return reply.send({
      success: true,
      token: result.token,
      message: 'Device paired successfully',
    })
  })

  // Get code info (for display while waiting)
  app.get('/auth/pair/status/:code', async (request, reply) => {
    const { code } = request.params as { code: string }
    const info = pairing.getCodeInfo(code)

    if (!info) {
      return reply.status(404).send({ error: 'Code not found or expired' })
    }

    return reply.send({
      deviceName: info.deviceName,
      expiresIn: Math.floor(info.expiresIn / 1000),
    })
  })

  // Cancel a pairing request
  app.delete('/auth/pair/:code', async (request, reply) => {
    const { code } = request.params as { code: string }
    const cancelled = pairing.cancelCode(code)

    if (!cancelled) {
      return reply.status(404).send({ error: 'Code not found' })
    }

    return reply.status(204).send()
  })

  // List active tokens (owner only)
  app.get('/auth/tokens', async (request, reply) => {
    if (!request.user || request.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Owner access required' })
    }

    const tokens = await tokenStore.list()

    return reply.send({
      tokens: tokens.map(t => ({
        hash: t.hash.slice(0, 8) + '...', // Partial hash for identification
        deviceName: t.deviceName,
        role: t.role,
        createdAt: new Date(t.createdAt).toISOString(),
        lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : null,
      })),
    })
  })

  // Revoke a token (owner only)
  app.delete('/auth/tokens/:hash', async (request, reply) => {
    if (!request.user || request.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Owner access required' })
    }

    const { hash } = request.params as { hash: string }

    // Find token by partial hash
    const tokens = await tokenStore.list()
    const token = tokens.find(t => t.hash.startsWith(hash))

    if (!token) {
      return reply.status(404).send({ error: 'Token not found' })
    }

    await tokenStore.revoke(token.hash)

    auditLogger.info('gateway', 'token_revoked', {
      tokenHash: hash,
      requestId: request.id,
    })

    return reply.status(204).send()
  })
}
