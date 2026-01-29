// Types
export type {
  ToolAction,
  ToolCapability,
  ToolOutput,
  ToolResult,
  ToolContext,
  ToolPlugin,
  ApprovalRequest,
} from './types.js'

export {
  formatAction,
  matchesActionPattern,
  computeApprovalId,
  OUTPUT_CAPS,
} from './types.js'

// Registry
export {
  ToolRegistry,
  getToolRegistry,
  resetToolRegistry,
} from './registry.js'

// Approval
export {
  ApprovalManager,
  createAutoApproveManager,
  createDenyAllManager,
  createInteractiveManager,
  type ApprovalCallback,
} from './approvals.js'

// Executor
export { ToolExecutor } from './executor.js'

// Builtin tools
export {
  builtinTools,
  registerBuiltinTools,
  readTool,
  writeTool,
  bashTool,
  webFetchTool,
} from './builtin/index.js'
