/**
 * Gateway module - HTTP/WebSocket API
 */

export type {
  GatewayConfig,
  GatewayContext,
  ClientMessage,
  ServerMessage,
} from './types.js'

export { createGateway, startGateway } from './server.js'
export { WebSocketChannel } from './websocket/channel.js'

// Auth
export {
  DevicePairing,
  FileTokenStore,
  generateToken,
  generateOwnerToken,
  createAuthMiddleware,
  type TokenStore,
  type TokenInfo,
  type PairingResult,
} from './auth/index.js'
