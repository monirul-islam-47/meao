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
import { SessionManager, JsonlSessionStore } from '../session/index.js'
import type { SessionMetadata } from '../session/index.js'
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

/**
 * List all saved sessions.
 */
export async function listSessions(): Promise<void> {
  const meaoDir = join(homedir(), '.meao')
  const sessionsDir = join(meaoDir, 'sessions')
  await mkdir(sessionsDir, { recursive: true })

  const store = new JsonlSessionStore(sessionsDir)
  const sessionManager = new SessionManager(store)

  const sessions = await sessionManager.listSessions({ limit: 20 })

  if (sessions.length === 0) {
    console.log('\nNo saved sessions found.')
    console.log('Start a new session with: meao session new\n')
    return
  }

  console.log('\nSaved sessions:\n')
  console.log('  ID                                    Updated              Messages  Title')
  console.log('  ' + '-'.repeat(80))

  for (const session of sessions) {
    const updated = new Date(session.updatedAt).toLocaleString()
    const title = session.title || '(untitled)'
    const id = session.id.substring(0, 36)
    const state = session.state === 'active' ? '*' : ' '
    console.log(`${state} ${id}  ${updated.padEnd(20)}  ${String(session.messageCount).padStart(8)}  ${title}`)
  }

  console.log('\nResume with: meao session resume <id>')
  console.log('* = active session\n')
}

/**
 * Format session info for display.
 */
function formatSessionInfo(session: SessionMetadata): string {
  const lines = [
    `Session ID: ${session.id}`,
    `State: ${session.state}`,
    `Created: ${new Date(session.createdAt).toLocaleString()}`,
    `Updated: ${new Date(session.updatedAt).toLocaleString()}`,
    `Messages: ${session.messageCount}`,
  ]
  if (session.title) lines.push(`Title: ${session.title}`)
  if (session.model) lines.push(`Model: ${session.model}`)
  if (session.totalTokens) lines.push(`Total tokens: ${session.totalTokens}`)
  return lines.join('\n')
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
  const sessionsDir = join(meaoDir, 'sessions')
  await mkdir(auditDir, { recursive: true })
  await mkdir(sessionsDir, { recursive: true })

  // Initialize session manager
  const sessionStore = new JsonlSessionStore(sessionsDir)
  const sessionManager = new SessionManager(sessionStore)

  // Resume or create session
  let sessionInfo: string
  if (options.resumeSession) {
    const session = await sessionManager.resumeSession(options.resumeSession as string)
    if (!session) {
      console.error(`Error: Session ${options.resumeSession} not found`)
      process.exit(1)
    }
    sessionInfo = `Resumed session: ${session.id}\nMessages: ${session.messageCount}`
  } else {
    const session = await sessionManager.newSession({ model, workDir })
    sessionInfo = `New session: ${session.id}`
  }

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
${sessionInfo}

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
        await sessionManager.pauseSession()
        const meta = sessionManager.getSessionMetadata()
        console.log(`\nSession ${meta?.id} saved. Resume with: meao session resume ${meta?.id}`)
        console.log('Goodbye!')
        rl.close()
        process.exit(0)
      }

      if (input.toLowerCase() === '/session') {
        const meta = sessionManager.getSessionMetadata()
        if (meta) {
          console.log(`\nSession: ${meta.id}`)
          console.log(`Messages: ${meta.messageCount}`)
          if (meta.totalTokens) console.log(`Tokens: ${meta.totalTokens}`)
        }
        prompt()
        return
      }

      if (input.toLowerCase() === '/help') {
        console.log(`
Commands:
  /help     Show this help
  /session  Show current session info
  /quit     Exit and save session
  /exit     Exit and save session
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
        // Persist user message
        await sessionManager.addUserMessage(input)

        // Process with orchestrator
        await orchestrator.processMessage(input)

        // Note: Assistant messages would be persisted via orchestrator hooks
        // For now, we just track the user messages
      } catch (error) {
        console.error('\nError:', error instanceof Error ? error.message : error)
      }

      prompt()
    })
  }

  // Handle Ctrl+C gracefully
  rl.on('close', async () => {
    await sessionManager.pauseSession()
    const meta = sessionManager.getSessionMetadata()
    console.log(`\nSession ${meta?.id} saved.`)
    console.log('Goodbye!')
    process.exit(0)
  })

  prompt()
}
