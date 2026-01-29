/**
 * Gateway server CLI
 */

import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { Orchestrator } from '../orchestrator/orchestrator.js'
import { AnthropicProvider } from '../provider/anthropic.js'
import { ToolRegistry, registerBuiltinTools } from '../tools/index.js'
import { ApprovalManager } from '../tools/approvals.js'
import { SandboxExecutor } from '../sandbox/executor.js'
import { AuditLogger, JsonlAuditStore } from '../audit/index.js'
import { CLIChannel } from '../channel/cli.js'
import { SessionManager, JsonlSessionStore } from '../session/index.js'
import { startGateway, type GatewayConfig } from '../gateway/index.js'

interface GatewayOptions {
  host: string
  port: number
  model?: string
  workDir?: string
}

export async function startGatewayServer(options: GatewayOptions): Promise<void> {
  const workDir = options.workDir || process.cwd()
  const model = options.model || 'claude-sonnet-4-20250514'

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error(`
Error: ANTHROPIC_API_KEY environment variable not set.

Set it with:
  export ANTHROPIC_API_KEY=sk-ant-...
`)
    process.exit(1)
  }

  // Ensure directories exist
  const meaoDir = join(homedir(), '.meao')
  const auditDir = join(meaoDir, 'audit')
  const sessionsDir = join(meaoDir, 'sessions')
  await mkdir(auditDir, { recursive: true })
  await mkdir(sessionsDir, { recursive: true })

  // Initialize components
  const provider = new AnthropicProvider({ apiKey })

  if (!provider.isAvailable()) {
    console.error('Error: Anthropic provider is not available')
    process.exit(1)
  }

  const toolRegistry = new ToolRegistry()
  registerBuiltinTools(toolRegistry)

  const channel = new CLIChannel() // Placeholder for gateway

  // For gateway, approvals come via WebSocket
  const approvalManager = new ApprovalManager(async () => {
    // Default deny for non-interactive - approvals should come via WS
    return false
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

  // Initialize session manager
  const sessionStore = new JsonlSessionStore(sessionsDir)
  const sessionManager = new SessionManager(sessionStore)

  // Start gateway
  const config: GatewayConfig = {
    host: options.host,
    port: options.port,
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEAO Gateway
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Starting HTTP/WebSocket server...
`)

  // Try starting on the configured port, with fallback ports
  const ports = [config.port, 3141, 3142, 3143, 8080, 8081]
  let app = null
  let actualPort = config.port

  for (const port of ports) {
    try {
      const testConfig = { ...config, port }
      app = await startGateway(testConfig, {
        orchestrator,
        sessionManager,
        auditLogger,
        config: testConfig,
      })
      actualPort = port
      break
    } catch (error: any) {
      if (error.code === 'EADDRINUSE') {
        console.log(`Port ${port} is in use, trying next...`)
        continue
      }
      throw error
    }
  }

  if (!app) {
    console.error('Failed to start gateway: all ports are in use')
    process.exit(1)
  }

  console.log(`
Endpoints:
  Health:     GET  http://${options.host}:${actualPort}/health
  Sessions:   POST http://${options.host}:${actualPort}/sessions
  WebSocket:  WS   ws://${options.host}:${actualPort}/ws

Press Ctrl+C to stop.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gateway...')
    await app!.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\nShutting down gateway...')
    await app!.close()
    process.exit(0)
  })
}
