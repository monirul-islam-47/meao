import { randomUUID } from 'crypto'
import type {
  OrchestratorState,
  OrchestratorConfig,
  OrchestratorDependencies,
  Session,
  Turn,
  ToolCall,
} from './types.js'
import { DEFAULT_CONFIG } from './types.js'
import { TypedEventEmitter } from '../channel/emitter.js'
import type {
  ChannelMessage,
  UserMessage,
} from '../channel/types.js'
import type {
  Provider,
  ConversationMessage,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  StreamEvent,
  ProviderResponse,
} from '../provider/types.js'
import type { ToolPlugin, ToolContext, ApprovalRequest } from '../tools/types.js'
import { ToolExecutor } from '../tools/executor.js'
import { secretDetector } from '../security/secrets/index.js'
import { ToolCallAssembler } from './tool-call-assembler.js'

/**
 * Main orchestrator for coordinating conversations.
 *
 * The orchestrator manages:
 * - Conversation flow between user and assistant
 * - Tool execution with approval flow
 * - Streaming responses
 * - Session state and cost tracking
 */
export class Orchestrator extends TypedEventEmitter {
  private state: OrchestratorState = 'idle'
  private config: Required<OrchestratorConfig>
  private deps: OrchestratorDependencies
  private session: Session
  private currentTurn: Turn | null = null
  private toolExecutor: ToolExecutor
  private messageQueue: string[] = []
  private readonly maxQueueSize = 5

  constructor(
    deps: OrchestratorDependencies,
    config: Partial<OrchestratorConfig> = {}
  ) {
    super()
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize tool executor with approval manager
    // This is the SINGLE enforcement point for all tool execution
    this.toolExecutor = new ToolExecutor(deps.approvalManager)

    // Initialize session
    this.session = this.createSession()

    // Subscribe to channel messages
    this.setupChannelListeners()
  }

  /**
   * Get current state.
   */
  getState(): OrchestratorState {
    return this.state
  }

  /**
   * Get current session.
   */
  getSession(): Session {
    return this.session
  }

  /**
   * Start the orchestrator.
   */
  async start(): Promise<void> {
    await this.deps.channel.connect()
    await this.deps.auditLogger.info('session', 'started', {
      sessionId: this.session.id,
      config: {
        model: this.config.model,
        maxTurns: this.config.maxTurns,
      },
    })
  }

  /**
   * Stop the orchestrator.
   */
  async stop(): Promise<void> {
    await this.deps.channel.disconnect()
    await this.deps.auditLogger.info('session', 'ended', {
      sessionId: this.session.id,
      totalTurns: this.session.turns.length,
      totalUsage: this.session.totalUsage,
      estimatedCost: this.session.estimatedCost,
    })

    this.emit('sessionEnd' as any, this.session)
  }

  /**
   * Process a user message.
   */
  async processMessage(userMessage: string): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot process message in state: ${this.state}`)
    }

    // Check turn limit
    if (this.session.turns.length >= this.config.maxTurns) {
      await this.sendError('max_turns_exceeded', 'Maximum turns reached for this session')
      return
    }

    // Create turn
    this.currentTurn = this.createTurn(userMessage)
    this.emit('turnStart' as any, this.currentTurn)

    this.setState('processing')

    try {
      // Add user message to conversation
      this.session.messages.push({
        role: 'user',
        content: userMessage,
      })

      // Process the conversation loop
      await this.conversationLoop()

      // Complete turn
      this.currentTurn.endTime = new Date()
      this.session.turns.push(this.currentTurn)
      this.emit('turnComplete' as any, this.currentTurn)
    } catch (error) {
      this.currentTurn.error =
        error instanceof Error ? error.message : 'Unknown error'
      this.currentTurn.endTime = new Date()
      this.session.turns.push(this.currentTurn)

      await this.sendError(
        'processing_error',
        error instanceof Error ? error.message : 'Unknown error'
      )
      this.emit('error' as any, error)
    } finally {
      this.currentTurn = null
      this.setState('idle')
    }
  }

  /**
   * Main conversation loop.
   */
  private async conversationLoop(): Promise<void> {
    let toolCallCount = 0

    while (true) {
      // Get model response
      const response = await this.getModelResponse()

      // Update usage
      this.currentTurn!.usage.inputTokens += response.usage.inputTokens
      this.currentTurn!.usage.outputTokens += response.usage.outputTokens
      this.session.totalUsage.inputTokens += response.usage.inputTokens
      this.session.totalUsage.outputTokens += response.usage.outputTokens
      this.updateCost()

      // Add assistant message to conversation
      this.session.messages.push({
        role: 'assistant',
        content: response.content,
      })

      // Check for tool use
      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      )

      if (toolUses.length === 0 || response.stopReason !== 'tool_use') {
        // No tool calls - extract text response
        const textContent = response.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as any).text)
          .join('\n')

        this.currentTurn!.assistantResponse = textContent

        // Send final response
        await this.sendAssistantMessage(textContent)
        break
      }

      // Check tool call limit
      toolCallCount += toolUses.length
      if (toolCallCount > this.config.maxToolCallsPerTurn) {
        await this.sendError(
          'max_tool_calls_exceeded',
          'Maximum tool calls per turn exceeded'
        )
        break
      }

      // Execute tool calls
      const toolResults = await this.executeToolCalls(toolUses)

      // Add tool results to conversation
      this.session.messages.push({
        role: 'user',
        content: toolResults,
      })
    }
  }

  /**
   * Get response from the model.
   */
  private async getModelResponse(): Promise<ProviderResponse> {
    const options = {
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      system: this.config.systemPrompt,
      tools: this.buildToolDefinitions(),
    }

    if (this.config.streaming) {
      return this.streamModelResponse(options)
    }

    return this.deps.provider.createMessage(this.session.messages, options)
  }

  /**
   * Stream model response.
   */
  private async streamModelResponse(
    options: any
  ): Promise<ProviderResponse> {
    this.setState('streaming')

    // Send stream start
    const streamId = randomUUID()
    await this.deps.channel.send({
      type: 'stream_start',
      id: streamId,
      timestamp: new Date(),
      sessionId: this.session.id,
      streamId,
    })

    const content: ContentBlock[] = []
    let stopReason: any = 'end_turn'
    let usage = { inputTokens: 0, outputTokens: 0 }
    let responseId = ''
    let model = ''
    let currentBlockIndex = -1
    let currentText = ''

    // Tool call assembler for handling streamed tool calls
    const toolAssembler = new ToolCallAssembler()
    const toolCallBlocks = new Map<number, { id: string; name: string }>()

    try {
      for await (const event of this.deps.provider.createMessageStream(
        this.session.messages,
        options
      )) {
        switch (event.type) {
          case 'message_start':
            if (event.message) {
              responseId = event.message.id ?? ''
              model = event.message.model ?? ''
              if (event.message.usage) {
                usage.inputTokens = event.message.usage.inputTokens ?? 0
              }
            }
            break

          case 'content_block_start':
            currentBlockIndex = event.index ?? 0
            if (event.contentBlock) {
              content[currentBlockIndex] = event.contentBlock

              if (event.contentBlock.type === 'text') {
                currentText = ''
              } else if (event.contentBlock.type === 'tool_use') {
                // Start tracking this tool call
                const block = event.contentBlock as any
                toolCallBlocks.set(currentBlockIndex, {
                  id: block.id,
                  name: block.name,
                })
                toolAssembler.startToolCall(block.id, block.name)
              }
            }
            break

          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && (event.delta as any).text) {
              // Handle text delta
              const delta = (event.delta as any).text
              currentText += delta
              // Stream text to channel
              await this.deps.channel.send({
                type: 'stream_delta',
                id: randomUUID(),
                timestamp: new Date(),
                sessionId: this.session.id,
                streamId,
                delta,
              })
            } else if (event.delta?.type === 'text' && (event.delta as any).text) {
              // Alternative text delta format
              const delta = (event.delta as any).text
              currentText += delta
              await this.deps.channel.send({
                type: 'stream_delta',
                id: randomUUID(),
                timestamp: new Date(),
                sessionId: this.session.id,
                streamId,
                delta,
              })
            } else if (event.delta?.type === 'input_json_delta') {
              // Handle tool call JSON delta
              const jsonDelta = (event.delta as any).partial_json ?? ''
              const blockInfo = toolCallBlocks.get(currentBlockIndex)
              if (blockInfo) {
                toolAssembler.addDelta(blockInfo.id, jsonDelta)
              }
            }
            break

          case 'content_block_stop':
            if (currentBlockIndex >= 0) {
              const block = content[currentBlockIndex]
              if (block?.type === 'text') {
                (block as any).text = currentText
              } else if (block?.type === 'tool_use') {
                // Finalize tool call JSON
                const blockInfo = toolCallBlocks.get(currentBlockIndex)
                if (blockInfo) {
                  const result = toolAssembler.endToolCall(blockInfo.id)
                  if (result.success) {
                    // Update the content block with parsed input
                    (block as any).input = result.toolCall.input
                  } else {
                    // Log error but don't throw - let the main loop handle it
                    await this.deps.auditLogger.warn('streaming', 'tool_call_parse_error', {
                      toolCallId: blockInfo.id,
                      error: result.error.error,
                    })
                  }
                }
              }
            }
            break

          case 'message_delta':
            if ((event.delta as any)?.stop_reason) {
              stopReason = (event.delta as any).stop_reason
            }
            // Track output tokens if provided (Anthropic reports usage at end of stream)
            if (event.usage?.outputTokens) {
              usage.outputTokens = event.usage.outputTokens
            }
            break
        }
      }
    } catch (error) {
      // Handle stream errors - fail any incomplete tool calls
      const failures = toolAssembler.failIncompleteCalls('Stream error: ' + (error as Error).message)
      if (failures.length > 0) {
        await this.deps.auditLogger.warn('streaming', 'incomplete_tool_calls', {
          failures: failures.map((f) => ({ id: f.id, error: f.error })),
        })
      }
      throw error
    }

    // Send stream end
    await this.deps.channel.send({
      type: 'stream_end',
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: this.session.id,
      streamId,
    })

    this.setState('processing')

    return {
      id: responseId,
      model,
      content,
      stopReason,
      usage,
    }
  }

  /**
   * Execute tool calls.
   */
  private async executeToolCalls(
    toolUses: ToolUseBlock[]
  ): Promise<ToolResultBlock[]> {
    this.setState('executing_tool')

    const results: ToolResultBlock[] = []

    for (const toolUse of toolUses) {
      const toolCall: ToolCall = {
        id: toolUse.id,
        name: toolUse.name,
        args: toolUse.input,
      }
      this.currentTurn!.toolCalls.push(toolCall)
      this.emit('toolCallStart' as any, toolCall)

      // Redact secrets from args before sending to channel (prevent leaks to UI/logs)
      const redactedArgs = this.redactArgsSecrets(toolUse.input)

      // Send tool use to channel
      await this.deps.channel.send({
        type: 'tool_use',
        id: toolUse.id,
        timestamp: new Date(),
        sessionId: this.session.id,
        name: toolUse.name,
        args: redactedArgs,
      })

      try {
        // Execute the tool
        const startTime = Date.now()
        const result = await this.executeTool(toolUse.name, toolUse.input, toolUse.id)
        toolCall.executionTime = Date.now() - startTime

        toolCall.result = {
          success: result.success,
          output: result.output,
          label: result.label,
        }

        // Send tool result to channel
        await this.deps.channel.send({
          type: 'tool_result',
          id: randomUUID(),
          timestamp: new Date(),
          sessionId: this.session.id,
          name: toolUse.name,
          success: result.success,
          output: result.output,
          correlationId: toolUse.id,
        })

        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.output,
          is_error: !result.success,
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        toolCall.result = {
          success: false,
          output: errorMsg,
        }

        // Send tool result to channel
        await this.deps.channel.send({
          type: 'tool_result',
          id: randomUUID(),
          timestamp: new Date(),
          sessionId: this.session.id,
          name: toolUse.name,
          success: false,
          output: `Error: ${errorMsg}`,
          correlationId: toolUse.id,
        })

        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: ${errorMsg}`,
          is_error: true,
        })
      }

      this.emit('toolCallComplete' as any, toolCall)
    }

    this.setState('processing')
    return results
  }

  /**
   * Execute a single tool via ToolExecutor (the single enforcement point).
   *
   * ToolExecutor handles:
   * - Argument validation
   * - Conditional approval checks (method, host, etc.)
   * - Network guard enforcement
   * - Secret redaction in output
   * - Label propagation
   * - Audit logging
   */
  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    callId: string
  ): Promise<{ success: boolean; output: string; label?: any }> {
    const tool = this.deps.toolRegistry.get(name)
    if (!tool) {
      return {
        success: false,
        output: `Unknown tool: ${name}`,
      }
    }

    // Create tool context
    const context: ToolContext = {
      sessionId: this.session.id,
      requestId: callId,
      approvals: this.session.approvals,
      audit: this.deps.auditLogger,
      sandbox: this.deps.sandboxExecutor,
      workDir: this.config.workDir,
    }

    // Emit approval required event for UI notification when tool needs approval
    // (ToolExecutor will actually handle the approval flow)
    if (tool.capability.approval.level !== 'auto') {
      this.emit('approvalRequired' as any, {
        id: callId,
        tool: name,
        action: 'execute',
        target: this.formatToolTarget(args),
        reason: `Tool ${name} requires approval`,
        isDangerous: this.isDangerousTool(tool, args),
      })
      this.setState('waiting_approval')
    }

    // Execute through ToolExecutor - this is the SINGLE enforcement choke point
    // It handles: validation, approval conditions, network guard, execution,
    // secret redaction, label propagation, and audit logging
    const result = await this.toolExecutor.execute(tool, args, context)

    if (tool.capability.approval.level !== 'auto') {
      this.setState('executing_tool')
    }

    // Return result with label (fixing label propagation)
    return {
      success: result.success,
      output: result.output,
      label: result.label,
    }
  }

  /**
   * Build tool definitions for provider.
   */
  private buildToolDefinitions(): any[] {
    return this.deps.toolRegistry.all().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.zodToJsonSchema(tool.parameters),
    }))
  }

  /**
   * Convert Zod schema to JSON Schema (simplified).
   */
  private zodToJsonSchema(schema: any): any {
    // This is a simplified conversion - in production we'd use a proper converter
    try {
      // Try to get the shape from Zod
      if (schema._def?.typeName === 'ZodObject') {
        const shape = schema._def.shape()
        const properties: Record<string, any> = {}
        const required: string[] = []

        for (const [key, value] of Object.entries(shape)) {
          const def = (value as any)._def
          let type = 'string'

          if (def?.typeName === 'ZodString') type = 'string'
          else if (def?.typeName === 'ZodNumber') type = 'number'
          else if (def?.typeName === 'ZodBoolean') type = 'boolean'
          else if (def?.typeName === 'ZodArray') type = 'array'

          properties[key] = {
            type,
            description: def?.description,
          }

          // Check if required (not optional/default)
          if (!def?.typeName?.includes('Optional') && !def?.defaultValue) {
            required.push(key)
          }
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        }
      }
    } catch {
      // Fall back to generic schema
    }

    return {
      type: 'object',
      properties: {},
    }
  }

  /**
   * Format tool target for display.
   */
  private formatToolTarget(args: Record<string, unknown>): string {
    const target = args.command ?? args.path ?? args.url ?? ''
    return String(target).slice(0, 100)
  }

  /**
   * Redact secrets from tool args before sending to channel/logs.
   * Prevents leaking secrets that users might paste into tool inputs.
   */
  private redactArgsSecrets(args: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        const { redacted: redactedValue } = secretDetector.redact(value)
        redacted[key] = redactedValue
      } else if (typeof value === 'object' && value !== null) {
        // Recursively redact nested objects
        redacted[key] = this.redactArgsSecrets(value as Record<string, unknown>)
      } else {
        redacted[key] = value
      }
    }

    return redacted
  }

  /**
   * Check if tool call is dangerous.
   */
  private isDangerousTool(tool: ToolPlugin, args: Record<string, unknown>): boolean {
    const patterns = tool.capability.approval.dangerPatterns
    if (!patterns?.length) return false

    const target = String(args.command ?? args.path ?? args.url ?? '')
    return patterns.some((p) => p.test(target))
  }

  /**
   * Create a new session.
   */
  private createSession(): Session {
    return {
      id: randomUUID(),
      startTime: new Date(),
      turns: [],
      messages: [],
      approvals: [],
      totalUsage: { inputTokens: 0, outputTokens: 0 },
      estimatedCost: 0,
    }
  }

  /**
   * Create a new turn.
   */
  private createTurn(userMessage: string): Turn {
    return {
      id: randomUUID(),
      number: this.session.turns.length + 1,
      userMessage,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      startTime: new Date(),
    }
  }

  /**
   * Update cost estimate.
   */
  private updateCost(): void {
    const inputCost =
      (this.session.totalUsage.inputTokens / 1_000_000) * this.config.inputTokenCost
    const outputCost =
      (this.session.totalUsage.outputTokens / 1_000_000) * this.config.outputTokenCost
    this.session.estimatedCost = inputCost + outputCost
  }

  /**
   * Set state and emit event.
   */
  private setState(state: OrchestratorState): void {
    if (this.state !== state) {
      this.state = state
      this.emit('stateChange' as any, state)
    }
  }

  /**
   * Send assistant message to channel.
   */
  private async sendAssistantMessage(content: string): Promise<void> {
    await this.deps.channel.send({
      type: 'assistant_message',
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: this.session.id,
      content,
    })
  }

  /**
   * Send error to channel.
   */
  private async sendError(code: string, message: string): Promise<void> {
    await this.deps.channel.send({
      type: 'error',
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: this.session.id,
      code,
      message,
      recoverable: true,
    })
  }

  /**
   * Setup channel message listeners.
   */
  private setupChannelListeners(): void {
    this.deps.channel.on('message', async (message: ChannelMessage) => {
      switch (message.type) {
        case 'user_message':
          await this.handleIncomingMessage((message as UserMessage).content)
          break
        // Note: approval_response is no longer handled here
        // The ApprovalManager handles approval flow internally
      }
    })
  }

  /**
   * Handle incoming user message with queueing.
   * If busy, queues the message or replies "busy" if queue is full.
   */
  private async handleIncomingMessage(content: string): Promise<void> {
    if (this.state === 'idle') {
      await this.processMessage(content)
      // Process any queued messages
      await this.processQueuedMessages()
    } else {
      // Orchestrator is busy - queue the message
      if (this.messageQueue.length < this.maxQueueSize) {
        this.messageQueue.push(content)
        await this.deps.channel.send({
          type: 'assistant_message',
          id: randomUUID(),
          timestamp: new Date(),
          sessionId: this.session.id,
          content: `Your message has been queued (position ${this.messageQueue.length}). I'll respond once I finish processing the current request.`,
        })
      } else {
        // Queue is full - reject the message
        await this.deps.channel.send({
          type: 'error',
          id: randomUUID(),
          timestamp: new Date(),
          sessionId: this.session.id,
          code: 'busy',
          message: 'I am currently busy and my message queue is full. Please wait for the current request to complete.',
          recoverable: true,
        })
      }
    }
  }

  /**
   * Process any queued messages after current turn completes.
   */
  private async processQueuedMessages(): Promise<void> {
    while (this.messageQueue.length > 0 && this.state === 'idle') {
      const nextMessage = this.messageQueue.shift()
      if (nextMessage) {
        await this.processMessage(nextMessage)
      }
    }
  }
}
