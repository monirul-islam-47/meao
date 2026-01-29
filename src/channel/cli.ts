import * as readline from 'readline'
import type {
  ChannelMessage,
  UserMessage,
  ApprovalRequestMessage,
  ApprovalResponseMessage,
  StreamDeltaMessage,
  StreamEndMessage,
  AssistantMessage,
  ErrorMessage,
  SystemMessage,
} from './types.js'
import { BaseChannel } from './base.js'

export interface CLIChannelOptions {
  /** Session ID (auto-generated if not provided) */
  sessionId?: string
  /** Input stream (defaults to process.stdin) */
  input?: NodeJS.ReadableStream
  /** Output stream (defaults to process.stdout) */
  output?: NodeJS.WritableStream
  /** Error stream (defaults to process.stderr) */
  error?: NodeJS.WritableStream
  /** Enable colored output */
  colors?: boolean
  /** Prompt string */
  prompt?: string
}

/**
 * CLI Channel for terminal-based interaction.
 */
export class CLIChannel extends BaseChannel {
  private rl: readline.Interface | null = null
  private input: NodeJS.ReadableStream
  private output: NodeJS.WritableStream
  private error: NodeJS.WritableStream
  private colors: boolean
  private prompt: string
  private currentStreamId: string | null = null
  private turnCounter = 0

  constructor(options: CLIChannelOptions = {}) {
    super(options.sessionId)
    this.input = options.input ?? process.stdin
    this.output = options.output ?? process.stdout
    this.error = options.error ?? process.stderr
    this.colors = options.colors ?? process.stdout.isTTY ?? false
    this.prompt = options.prompt ?? '> '
  }

  /**
   * Connect and start listening for input.
   */
  async connect(): Promise<void> {
    if (this._state === 'connected') return

    this.setState('connecting')

    this.rl = readline.createInterface({
      input: this.input,
      output: this.output,
      prompt: this.prompt,
      terminal: (this.input as any).isTTY ?? false,
    })

    this.rl.on('line', (line) => {
      this.handleInput(line)
    })

    this.rl.on('close', () => {
      this.disconnect()
    })

    this.setState('connected')
    this.emit(
      'message',
      this.createMessage<SystemMessage>('system', {
        event: 'connected',
      })
    )
  }

  /**
   * Disconnect the channel.
   */
  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') return

    this.rl?.close()
    this.rl = null

    this.setState('disconnected')
    this.emit(
      'message',
      this.createMessage<SystemMessage>('system', {
        event: 'disconnected',
      })
    )
  }

  /**
   * Send a message through the channel.
   */
  async send(message: ChannelMessage): Promise<void> {
    switch (message.type) {
      case 'assistant_message':
        this.renderAssistantMessage(message as AssistantMessage)
        break

      case 'stream_start':
        this.currentStreamId = message.id
        break

      case 'stream_delta':
        this.renderStreamDelta(message as StreamDeltaMessage)
        break

      case 'stream_end':
        this.renderStreamEnd(message as StreamEndMessage)
        this.currentStreamId = null
        break

      case 'tool_use':
        this.renderToolUse(message)
        break

      case 'tool_result':
        this.renderToolResult(message)
        break

      case 'approval_request':
        await this.handleApprovalRequest(message as ApprovalRequestMessage)
        break

      case 'error':
        this.renderError(message as ErrorMessage)
        break

      case 'system':
        this.renderSystem(message as SystemMessage)
        break

      default:
        // Ignore other message types on output
        break
    }
  }

  /**
   * Show the prompt.
   */
  showPrompt(): void {
    this.rl?.prompt()
  }

  /**
   * Handle user input.
   */
  private handleInput(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) {
      this.showPrompt()
      return
    }

    this.turnCounter++

    const message = this.createMessage<UserMessage>('user_message', {
      content: trimmed,
      turnId: `turn-${this.turnCounter}`,
      metadata: {
        cwd: process.cwd(),
      },
    })

    this.emit('message', message)
  }

  /**
   * Render assistant message.
   */
  private renderAssistantMessage(message: AssistantMessage): void {
    // Show thinking if present
    if (message.thinking) {
      this.writeLine(this.colorize('dim', `[Thinking: ${message.thinking}]`))
    }

    // Show content
    if (message.content) {
      this.writeLine(message.content)
    }

    this.writeLine('')
    this.showPrompt()
  }

  /**
   * Render streaming delta.
   */
  private renderStreamDelta(message: StreamDeltaMessage): void {
    if (message.isThinking) {
      this.write(this.colorize('dim', message.delta))
    } else {
      this.write(message.delta)
    }
  }

  /**
   * Render stream end.
   */
  private renderStreamEnd(message: StreamEndMessage): void {
    this.writeLine('')
    this.writeLine('')
    this.showPrompt()
  }

  /**
   * Render tool use.
   */
  private renderToolUse(message: ChannelMessage): void {
    const toolMsg = message as any
    this.writeLine(
      this.colorize('cyan', `[Tool: ${toolMsg.name}]`)
    )
  }

  /**
   * Render tool result.
   */
  private renderToolResult(message: ChannelMessage): void {
    const resultMsg = message as any
    const status = resultMsg.success
      ? this.colorize('green', '✓')
      : this.colorize('red', '✗')
    this.writeLine(`${status} ${resultMsg.name}`)

    if (resultMsg.output) {
      const outputLines = resultMsg.output.split('\n')
      const maxLines = 10
      if (outputLines.length > maxLines) {
        outputLines.slice(0, maxLines).forEach((line: string) =>
          this.writeLine(this.colorize('dim', `  ${line}`))
        )
        this.writeLine(
          this.colorize('dim', `  ... ${outputLines.length - maxLines} more lines`)
        )
      } else {
        outputLines.forEach((line: string) =>
          this.writeLine(this.colorize('dim', `  ${line}`))
        )
      }
    }
  }

  /**
   * Handle approval request.
   */
  private async handleApprovalRequest(
    message: ApprovalRequestMessage
  ): Promise<void> {
    this.writeLine('')
    if (message.isDangerous) {
      this.writeLine(this.colorize('yellow', '⚠️  DANGEROUS ACTION'))
    }
    this.writeLine(
      this.colorize('yellow', `Tool "${message.tool}" wants to: ${message.action}`)
    )
    if (message.target) {
      this.writeLine(`  Target: ${message.target}`)
    }
    if (message.reason) {
      this.writeLine(`  Reason: ${message.reason}`)
    }

    const response = await this.prompt_approval()

    const approvalResponse = this.createMessage<ApprovalResponseMessage>(
      'approval_response',
      {
        approvalId: message.approvalId,
        approved: response.approved,
        rememberSession: response.rememberSession,
        rememberAlways: response.rememberAlways,
      }
    )

    this.emit('message', approvalResponse)
  }

  /**
   * Prompt user for approval.
   */
  private async prompt_approval(): Promise<{
    approved: boolean
    rememberSession?: boolean
    rememberAlways?: boolean
  }> {
    return new Promise((resolve) => {
      const question = this.colorize(
        'yellow',
        'Allow? [y]es / [n]o / [a]lways / [s]ession: '
      )

      this.rl?.question(question, (answer) => {
        const lower = answer.toLowerCase().trim()

        switch (lower) {
          case 'y':
          case 'yes':
            resolve({ approved: true })
            break
          case 'a':
          case 'always':
            resolve({ approved: true, rememberAlways: true })
            break
          case 's':
          case 'session':
            resolve({ approved: true, rememberSession: true })
            break
          default:
            resolve({ approved: false })
            break
        }
      })
    })
  }

  /**
   * Render error.
   */
  private renderError(message: ErrorMessage): void {
    this.writeError(
      this.colorize('red', `Error [${message.code}]: ${message.message}`)
    )
    if (!message.recoverable) {
      this.writeError(this.colorize('red', 'This error is not recoverable.'))
    }
  }

  /**
   * Render system message.
   */
  private renderSystem(message: SystemMessage): void {
    switch (message.event) {
      case 'connected':
        this.writeLine(this.colorize('green', 'Connected.'))
        break
      case 'disconnected':
        this.writeLine(this.colorize('yellow', 'Disconnected.'))
        break
      case 'rate_limited':
        this.writeLine(this.colorize('yellow', 'Rate limited. Please wait...'))
        break
      case 'context_overflow':
        this.writeLine(
          this.colorize('yellow', 'Context overflow. Starting new conversation...')
        )
        break
      case 'cost_update':
        const data = message.data as { totalCost?: number } | undefined
        if (data?.totalCost !== undefined) {
          this.writeLine(
            this.colorize('dim', `[Cost: $${data.totalCost.toFixed(4)}]`)
          )
        }
        break
    }
  }

  /**
   * Write to output.
   */
  private write(text: string): void {
    this.output.write(text)
  }

  /**
   * Write line to output.
   */
  private writeLine(text: string): void {
    this.output.write(text + '\n')
  }

  /**
   * Write to error stream.
   */
  private writeError(text: string): void {
    this.error.write(text + '\n')
  }

  /**
   * Apply color to text.
   */
  private colorize(
    color: 'red' | 'green' | 'yellow' | 'cyan' | 'dim',
    text: string
  ): string {
    if (!this.colors) return text

    const codes: Record<string, string> = {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      dim: '\x1b[2m',
    }
    const reset = '\x1b[0m'

    return `${codes[color]}${text}${reset}`
  }
}
