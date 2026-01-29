import type { ToolRegistry } from '../registry.js'
import { readTool } from './read.js'
import { writeTool } from './write.js'
import { bashTool } from './bash.js'
import { webFetchTool } from './web_fetch.js'

/**
 * All builtin tools.
 */
export const builtinTools = [
  readTool,
  writeTool,
  bashTool,
  webFetchTool,
]

/**
 * Register all builtin tools in a registry.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of builtinTools) {
    registry.register(tool)
  }
}

// Re-export individual tools
export { readTool } from './read.js'
export { writeTool } from './write.js'
export { bashTool } from './bash.js'
export { webFetchTool } from './web_fetch.js'
