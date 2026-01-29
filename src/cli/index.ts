/**
 * MEAO CLI - Main entry point
 */

import { parseArgs } from './args.js'
import { runDemo, listDemos, showDemo } from './demo.js'
import { startSession } from './session.js'

export async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2))

  if (flags.help) {
    printHelp()
    return
  }

  if (flags.version) {
    console.log('0.0.1')
    return
  }

  switch (command) {
    case 'demo':
      await handleDemo(args, flags)
      break
    case 'sessions':
      await handleSessions(args, flags)
      break
    case 'session':
      await handleSession(args, flags)
      break
    default:
      // Default: start interactive session
      await startSession(flags)
  }
}

async function handleDemo(args: string[], flags: Record<string, boolean | string>): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case 'list':
      listDemos()
      break
    case 'show':
      showDemo(args[1])
      break
    case 'run':
      await runDemo(args[1], flags)
      break
    default:
      console.log(`Usage: meao demo <list|show|run> [demo-name]

Commands:
  list              List available demos
  show <name>       Show demo prompt and description
  run <name>        Run demo interactively

Available demos:
  golden-path       Provider + web_fetch + audit pipeline
  repo-assistant    Read + sandboxed bash + report
  file-ops          Secure read/write operations
`)
  }
}

async function handleSessions(args: string[], _flags: Record<string, boolean | string>): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case 'list':
      console.log('Session listing not yet implemented (M8.5)')
      break
    default:
      console.log(`Usage: meao sessions <list>

Commands:
  list    List saved sessions
`)
  }
}

async function handleSession(args: string[], flags: Record<string, boolean | string>): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case 'new':
      await startSession({ ...flags, newSession: true })
      break
    case 'resume':
      if (!args[1]) {
        console.error('Error: session ID required')
        console.log('Usage: meao session resume <id>')
        return
      }
      await startSession({ ...flags, resumeSession: args[1] })
      break
    default:
      console.log(`Usage: meao session <new|resume> [id]

Commands:
  new           Start a new session
  resume <id>   Resume an existing session
`)
  }
}

function printHelp(): void {
  console.log(`meao - Minimal Extensible AI Orchestrator

Usage:
  meao [options]              Start interactive session
  meao demo <command>         Run demo workflows
  meao sessions list          List saved sessions
  meao session new            Start new session
  meao session resume <id>    Resume a session

Options:
  -h, --help      Show this help message
  -v, --version   Show version
  --model <name>  Model to use (default: claude-sonnet-4-20250514)
  --work-dir      Working directory (default: current)

Demos:
  meao demo list              List available demos
  meao demo show <name>       Show demo details
  meao demo run <name>        Run a demo interactively

For more information, see docs/demos.md
`)
}
