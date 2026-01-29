# Milestone 6: CLI Channel

**Status:** COMPLETE
**Scope:** MVP
**Dependencies:** M5 (Tool System)
**PR:** PR7

---

## Goal

Build the first user interface with approval prompts and streaming. CLI-first validates the entire stack before adding network complexity.

**Spec Reference:** [API.md](../API.md) (channel interface)

---

## File Structure

```
src/channels/
├── index.ts                   # Public exports
├── types.ts                   # Channel interface
├── cli/
│   ├── index.ts               # CLI channel implementation
│   ├── repl.ts                # Interactive REPL loop
│   ├── render.ts              # Output rendering + streaming
│   ├── approval.ts            # Approval prompts
│   ├── context.ts             # RequestContext builder
│   └── commands.ts            # Built-in CLI commands
└── base.ts                    # Base channel class
```

---

## Key Exports

```typescript
// src/channels/index.ts
export { type Channel, type ChannelMessage, type ChannelResponse } from './types'
export { CLIChannel } from './cli'
```

---

## Implementation Requirements

### 1. Channel Interface (types.ts)

```typescript
export interface Channel {
  name: string
  initialize(): Promise<void>
  shutdown(): Promise<void>

  // Message handling
  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse>): void

  // Approval prompts
  requestApproval(request: ApprovalRequest): Promise<boolean>

  // Streaming
  streamDelta(delta: string): void
  streamComplete(): void

  // Optional hooks for tool execution
  onToolCallStart?(name: string, summary?: string): void
  onToolCallResult?(name: string, success: boolean): void
}

export interface ChannelMessage {
  id: string
  userId: string
  content: string
  attachments?: Attachment[]
  timestamp: Date
}

export interface ChannelResponse {
  content: string
  toolCalls?: ToolCallSummary[]
}

export interface Attachment {
  type: 'file' | 'image'
  name: string
  path?: string
  url?: string
}
```

### 2. CLI Channel (cli/index.ts)

```typescript
import { randomUUID } from 'crypto'
import { Channel, ChannelMessage, ChannelResponse } from '../types'
import { CLIRepl } from './repl'
import { StreamRenderer } from './render'
import { promptApproval } from './approval'
import { ApprovalRequest } from '../../tools'

export class CLIChannel implements Channel {
  name = 'cli'
  private repl: CLIRepl
  private renderer: StreamRenderer
  private messageHandler: ((msg: ChannelMessage) => Promise<ChannelResponse>) | null = null
  private ownerId: string

  constructor(ownerId: string) {
    this.ownerId = ownerId
    this.renderer = new StreamRenderer()
    this.repl = new CLIRepl(this)
  }

  async initialize(): Promise<void> {
    console.log('meao CLI - Type /help for commands, /quit to exit\n')
  }

  async shutdown(): Promise<void> {
    this.repl.close()
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse>): void {
    this.messageHandler = handler
  }

  async handleInput(content: string): Promise<void> {
    if (!this.messageHandler) {
      console.error('No message handler set')
      return
    }

    const message: ChannelMessage = {
      id: randomUUID(),
      userId: this.ownerId,
      content,
      timestamp: new Date(),
    }

    await this.messageHandler(message)
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    return promptApproval(request, this.repl.getReadline())
  }

  streamDelta(delta: string): void {
    this.renderer.streamDelta(delta)
  }

  streamComplete(): void {
    this.renderer.streamComplete()
  }

  onToolCallStart(name: string, summary?: string): void {
    this.renderer.onToolCallStart(name, summary)
  }

  onToolCallResult(name: string, success: boolean): void {
    this.renderer.onToolCallResult(name, success)
  }

  async start(): Promise<void> {
    await this.initialize()
    await this.repl.start()
  }
}
```

### 3. REPL (cli/repl.ts)

```typescript
import readline from 'readline'
import { CLIChannel } from './index'
import { handleCommand } from './commands'

export class CLIRepl {
  private rl: readline.Interface
  private channel: CLIChannel

  constructor(channel: CLIChannel) {
    this.channel = channel
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'meao> ',
    })
  }

  getReadline(): readline.Interface {
    return this.rl
  }

  async start(): Promise<void> {
    this.rl.prompt()

    for await (const line of this.rl) {
      const trimmed = line.trim()

      if (!trimmed) {
        this.rl.prompt()
        continue
      }

      if (trimmed.startsWith('/')) {
        const shouldContinue = await handleCommand(trimmed, this.channel)
        if (!shouldContinue) break
      } else {
        await this.channel.handleInput(trimmed)
      }

      this.rl.prompt()
    }
  }

  close(): void {
    this.rl.close()
  }
}
```

### 4. Stream Renderer (cli/render.ts)

```typescript
import chalk from 'chalk'

export class StreamRenderer {
  private currentLine = ''

  streamDelta(delta: string): void {
    process.stdout.write(delta)
    this.currentLine += delta

    if (delta.includes('\n')) {
      this.currentLine = delta.split('\n').pop() ?? ''
    }
  }

  streamComplete(): void {
    if (this.currentLine) {
      process.stdout.write('\n')
    }
    this.currentLine = ''
    console.log()  // Extra newline for readability
  }

  onToolCallStart(name: string, summary?: string): void {
    const msg = summary ? `${name}: ${summary}` : name
    console.log(chalk.dim(`\n[Calling ${msg}...]`))
  }

  onToolCallResult(name: string, success: boolean): void {
    const icon = success ? chalk.green('✓') : chalk.red('✗')
    console.log(chalk.dim(`[${icon} ${name} complete]\n`))
  }
}
```

### 5. Approval Prompts (cli/approval.ts)

```typescript
import readline from 'readline'
import chalk from 'chalk'
import { ApprovalRequest } from '../../tools'

export async function promptApproval(
  request: ApprovalRequest,
  rl: readline.Interface
): Promise<boolean> {
  console.log('\n' + chalk.yellow('═'.repeat(50)))
  console.log(chalk.yellow.bold('  Approval Required'))
  console.log(chalk.yellow('═'.repeat(50)))

  console.log(`\n  ${chalk.cyan('Tool:')} ${request.tool}`)
  console.log(`  ${chalk.cyan('Action:')} ${request.summary}`)

  if (request.risks.length > 0) {
    console.log(`\n  ${chalk.red('Risks:')}`)
    for (const risk of request.risks) {
      console.log(`    ${chalk.red('•')} ${risk}`)
    }
  }

  console.log('\n' + chalk.yellow('─'.repeat(50)))

  const answer = await question(rl, '  Allow? [y/N/details] ')
  const normalized = answer.toLowerCase().trim()

  if (normalized === 'details' || normalized === 'd') {
    console.log('\n  ' + chalk.dim('Full details:'))
    console.log(chalk.dim(JSON.stringify(request.details ?? {}, null, 2)))
    return promptApproval(request, rl)
  }

  const approved = normalized === 'y' || normalized === 'yes'
  console.log()

  return approved
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve)
  })
}
```

### 6. Built-in Commands (cli/commands.ts)

```typescript
import { CLIChannel } from './index'

export async function handleCommand(
  input: string,
  channel: CLIChannel
): Promise<boolean> {
  const [cmd, ...args] = input.slice(1).split(/\s+/)

  switch (cmd.toLowerCase()) {
    case 'quit':
    case 'exit':
    case 'q':
      console.log('Goodbye!')
      return false

    case 'help':
    case 'h':
    case '?':
      printHelp()
      return true

    case 'clear':
      console.clear()
      return true

    case 'version':
      console.log('meao v0.1.0')
      return true

    default:
      console.log(`Unknown command: /${cmd}. Type /help for available commands.`)
      return true
  }
}

function printHelp(): void {
  console.log(`
Available commands:
  /help, /h, /?    Show this help message
  /clear           Clear the screen
  /version         Show version
  /quit, /exit, /q Exit the CLI

Just type a message to chat with meao.
`)
}
```

### 7. Owner Initialization

```typescript
// src/channels/cli/owner.ts
import { randomUUID } from 'crypto'
import { getMeaoHome } from '../../config'
import { promises as fs } from 'fs'
import path from 'path'

interface OwnerProfile {
  id: string
  role: 'owner'
  displayName: string
  createdAt: string
}

export async function getOrCreateOwnerId(): Promise<string> {
  const profilePath = path.join(getMeaoHome(), 'owner.json')

  try {
    const content = await fs.readFile(profilePath, 'utf-8')
    const profile: OwnerProfile = JSON.parse(content)
    return profile.id
  } catch {
    // Create new owner
    const profile: OwnerProfile = {
      id: randomUUID(),
      role: 'owner',
      displayName: 'Owner',
      createdAt: new Date().toISOString(),
    }

    await fs.mkdir(path.dirname(profilePath), { recursive: true })
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2))

    return profile.id
  }
}
```

---

## Tests

```
test/channels/cli/
├── repl.test.ts
├── approval.test.ts
├── render.test.ts
└── commands.test.ts
```

### Critical Test Cases

```typescript
// test/channels/cli/approval.test.ts
describe('promptApproval', () => {
  it('returns true for y', async () => {
    const rl = createMockReadline(['y'])
    const result = await promptApproval(request, rl)
    expect(result).toBe(true)
  })

  it('returns false for n', async () => {
    const rl = createMockReadline(['n'])
    const result = await promptApproval(request, rl)
    expect(result).toBe(false)
  })

  it('shows details and re-prompts for d', async () => {
    const rl = createMockReadline(['d', 'y'])
    const result = await promptApproval(request, rl)
    expect(result).toBe(true)
    // Verify details were printed
  })
})
```

---

## Definition of Done

- [ ] CLI REPL accepts input and displays responses
- [ ] Streaming tokens render incrementally
- [ ] Approval prompts show tool, action, risks
- [ ] Approval supports [y/N/details]
- [ ] Built-in commands work (/help, /quit, /clear)
- [ ] Owner UUID created on first run
- [ ] All tests pass
- [ ] `pnpm check` passes

---

## Dependencies to Add

```bash
pnpm add chalk
```

---

## Next Milestone

After completing M6, proceed to [M7: Provider](./M7-provider.md).

---

*Last updated: 2026-01-29*
