/**
 * Gateway types
 */

import type { FastifyRequest } from 'fastify'
import type { Orchestrator } from '../orchestrator/orchestrator.js'
import type { SessionManager } from '../session/manager.js'
import type { AuditLogger } from '../audit/service.js'

// Augment Fastify request to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string
      role: 'owner' | 'user'
    }
  }
}

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  /** Host to bind (default: 127.0.0.1) */
  host: string
  /** Port to bind (default: 3000) */
  port: number
  /** Enable CORS (default: false for localhost) */
  cors?: boolean
}

/**
 * Shared context for route handlers
 */
export interface GatewayContext {
  orchestrator: Orchestrator
  sessionManager: SessionManager
  auditLogger: AuditLogger
  config: GatewayConfig
}

/**
 * WebSocket message types (client -> server)
 */
export type ClientMessage =
  | { type: 'message'; content: string; sessionId: string }
  | { type: 'approval_response'; requestId: string; approved: boolean }
  | { type: 'ping' }

/**
 * WebSocket message types (server -> client)
 */
export type ServerMessage =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_result'; id: string; name: string; success: boolean }
  | { type: 'approval_request'; requestId: string; tool: string; action: string; reason: string }
  | { type: 'message_complete'; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' }
  | { type: 'session_created'; sessionId: string }
