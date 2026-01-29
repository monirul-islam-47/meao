import type { Channel, ChannelMessage } from '../channel/types.js'
import type { Provider, ProviderRequestOptions, ConversationMessage } from '../provider/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { ApprovalManager } from '../tools/approvals.js'
import type { SandboxExecutor } from '../sandbox/executor.js'
import type { AuditLogger } from '../audit/service.js'
import type { ContentLabel } from '../security/labels/types.js'

/**
 * Orchestrator state.
 */
export type OrchestratorState =
  | 'idle'
  | 'processing'
  | 'waiting_approval'
  | 'executing_tool'
  | 'streaming'
  | 'error'

/**
 * Turn in the conversation.
 */
export interface Turn {
  /** Unique turn ID */
  id: string
  /** Turn number in session */
  number: number
  /** User message that started this turn */
  userMessage: string
  /** Assistant response */
  assistantResponse?: string
  /** Tool calls made in this turn */
  toolCalls: ToolCall[]
  /** Token usage for this turn */
  usage: {
    inputTokens: number
    outputTokens: number
  }
  /** Start time */
  startTime: Date
  /** End time */
  endTime?: Date
  /** Error if turn failed */
  error?: string
}

/**
 * Tool call in a turn.
 */
export interface ToolCall {
  /** Tool call ID */
  id: string
  /** Tool name */
  name: string
  /** Tool arguments */
  args: Record<string, unknown>
  /** Tool result */
  result?: {
    success: boolean
    output: string
    label?: ContentLabel
  }
  /** Whether user approved (if approval was needed) */
  approved?: boolean
  /** Execution time in ms */
  executionTime?: number
}

/**
 * Session state.
 */
export interface Session {
  /** Session ID */
  id: string
  /** Start time */
  startTime: Date
  /** Turns in the session */
  turns: Turn[]
  /** Current conversation messages */
  messages: ConversationMessage[]
  /** Granted approvals */
  approvals: string[]
  /** Total token usage */
  totalUsage: {
    inputTokens: number
    outputTokens: number
  }
  /** Estimated cost in USD */
  estimatedCost: number
}

/**
 * Orchestrator configuration.
 */
export interface OrchestratorConfig {
  /** System prompt */
  systemPrompt?: string
  /** Model to use */
  model?: string
  /** Max tokens per response */
  maxTokens?: number
  /** Max turns per session */
  maxTurns?: number
  /** Max tool calls per turn */
  maxToolCallsPerTurn?: number
  /** Working directory */
  workDir?: string
  /** Enable streaming */
  streaming?: boolean
  /** Cost per 1M input tokens (USD) */
  inputTokenCost?: number
  /** Cost per 1M output tokens (USD) */
  outputTokenCost?: number
}

/**
 * Orchestrator dependencies.
 */
export interface OrchestratorDependencies {
  /** Channel for communication */
  channel: Channel
  /** LLM provider */
  provider: Provider
  /** Tool registry */
  toolRegistry: ToolRegistry
  /** Approval manager */
  approvalManager: ApprovalManager
  /** Sandbox executor */
  sandboxExecutor: SandboxExecutor
  /** Audit logger */
  auditLogger: AuditLogger
}

/**
 * Orchestrator events.
 */
export interface OrchestratorEvents {
  /** State changed */
  stateChange: (state: OrchestratorState) => void
  /** Turn started */
  turnStart: (turn: Turn) => void
  /** Turn completed */
  turnComplete: (turn: Turn) => void
  /** Tool call started */
  toolCallStart: (toolCall: ToolCall) => void
  /** Tool call completed */
  toolCallComplete: (toolCall: ToolCall) => void
  /** Error occurred */
  error: (error: Error) => void
  /** Session ended */
  sessionEnd: (session: Session) => void
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Required<OrchestratorConfig> = {
  systemPrompt: `You are a helpful AI assistant. You have access to tools that can help you accomplish tasks. When you need to perform actions like reading files, running commands, or fetching web content, use the available tools.

Be concise but thorough in your responses. If a task requires multiple steps, explain your plan before executing.

Important guidelines:
- Ask for clarification if the user's request is ambiguous
- Explain what you're doing before using tools
- Handle errors gracefully and suggest alternatives`,
  model: 'claude-sonnet-4-20250514',
  maxTokens: 8192,
  maxTurns: 100,
  maxToolCallsPerTurn: 25,
  workDir: process.cwd(),
  streaming: true,
  inputTokenCost: 3.0, // $3 per 1M input tokens
  outputTokenCost: 15.0, // $15 per 1M output tokens
}
