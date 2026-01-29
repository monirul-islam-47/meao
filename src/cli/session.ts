/**
 * Session management for MEAO CLI
 */

import { createInterface } from 'readline'
import { Orchestrator } from '../orchestrator/orchestrator.js'
import { AnthropicProvider } from '../provider/anthropic.js'
import { ToolRegistry, registerBuiltinTools } from '../tools/index.js'
import { ApprovalManager } from '../tools/approvals.js'
import { SandboxExecutor } from '../sandbox/executor.js'
import { AuditLogger, JsonlAuditStore } from '../audit/index.js'
import { CLIChannel } from '../channel/cli.js'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'

export interface SessionOptions {
  model?: string
  workDir?: string
  newSession?: boolean
  resumeSession?: string
  demoPrompt?: string
  [key: string]: boolean | string | undefined
}

export async function startSession(options: SessionOptions = {}): Promise<void> {
  const workDir = (options.workDir as string) || process.cwd()
  const model = (options.model as string) || 'claude-sonnet-4-20250514'

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error(`
Error: ANTHROPIC_API_KEY environment variable not set.

Set it with:
  export ANTHROPIC_API_KEY=sk-ant-...

Or add to ~/.meao/config.json:
  { "anthropicApiKey": "sk-ant-..." }
`)
    process.exit(1)
  }

  // Ensure directories exist
  const meaoDir = join(homedir(), '.meao')
  const auditDir = join(meaoDir, 'audit')
  await mkdir(auditDir, { recursive: true })

  // Initialize components
  const provider = new AnthropicProvider({ apiKey })

  if (!provider.isAvailable()) {
    console.error('Error: Anthropic provider is not available')
    process.exit(1)
  }

  const toolRegistry = new ToolRegistry()
  registerBuiltinTools(toolRegistry)

  const channel = new CLIChannel()

  // Interactive approval manager
  const approvalManager = new ApprovalManager(async (request) => {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      console.log(`
[?] Approval required for: ${request.tool}
    Action: ${request.action}
    Target: ${request.target || '(none)'}
    Reason: ${request.reason || 'Tool requires approval'}
    ${request.isDangerous ? '    WARNING: Potentially dangerous operation' : ''}
`)

      rl.question('    [y/n/always/never]: ', (answer) => {
        rl.close()
        const normalized = answer.toLowerCase().trim()
        if (normalized === 'y' || normalized === 'yes' || normalized === 'always') {
          resolve(true)
        } else {
          resolve(false)
        }
      })
    })
  })

  const sandboxExecutor = new SandboxExecutor({ workDir })
  const auditStore = new JsonlAuditStore(auditDir)
  const auditLogger = new AuditLogger(auditStore)

  const orchestrator = new Orchestrator(
    {
      channel,
      provider,
      toolRegistry,
      approvalManager,
      sandboxExecutor,
      auditLogger,
    },
    {
      streaming: true,
      workDir,
      model,
    }
  )

  // Connect channel
  await channel.connect()

  // Print welcome
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEAO - Minimal Extensible AI Orchestrator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Model: ${model}
Work directory: ${workDir}
Audit log: ${auditDir}

Type your message and press Enter. Use Ctrl+C to exit.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)

  // Handle demo prompt
  if (options.demoPrompt) {
    await orchestrator.start()
    await orchestrator.processMessage(options.demoPrompt)
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Demo complete. Starting interactive session...')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  } else {
    await orchestrator.start()
  }

  // Interactive REPL
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = () => {
    rl.question('\n> ', async (input) => {
      if (!input.trim()) {
        prompt()
        return
      }

      if (input.toLowerCase() === '/quit' || input.toLowerCase() === '/exit') {
        console.log('\nGoodbye!')
        rl.close()
        process.exit(0)
      }

      if (input.toLowerCase() === '/help') {
        console.log(`
Commands:
  /help     Show this help
  /quit     Exit MEAO
  /exit     Exit MEAO
  /audit    Show recent audit entries
  /clear    Clear the screen

Otherwise, type your message to the AI.
`)
        prompt()
        return
      }

      if (input.toLowerCase() === '/clear') {
        console.clear()
        prompt()
        return
      }

      if (input.toLowerCase() === '/audit') {
        console.log('\nRecent audit entries:')
        // TODO: Implement audit log viewing
        console.log('  (Not yet implemented)')
        prompt()
        return
      }

      try {
        await orchestrator.processMessage(input)
      } catch (error) {
        console.error('\nError:', error instanceof Error ? error.message : error)
      }

      prompt()
    })
  }

  // Handle Ctrl+C gracefully
  rl.on('close', () => {
    console.log('\nGoodbye!')
    process.exit(0)
  })

  prompt()
}
