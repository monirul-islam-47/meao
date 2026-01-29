/**
 * Gateway authentication module
 */

export { DevicePairing, type PairingResult } from './pairing.js'
export {
  FileTokenStore,
  generateToken,
  generateOwnerToken,
  type TokenStore,
  type TokenInfo,
} from './tokens.js'
export { createAuthMiddleware, requireOwner } from './middleware.js'
