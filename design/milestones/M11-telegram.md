# Milestone 11: Telegram Channel

**Status:** NOT STARTED
**Scope:** Phase 2
**Dependencies:** M8 (Orchestrator)
**PR:** PR11

---

## Goal

Implement Telegram as the second channel, validating the multi-channel architecture. Telegram provides mobile access and demonstrates approval flows via inline buttons.

---

## File Structure

```
src/channels/telegram/
├── index.ts                   # Telegram channel implementation
├── bot.ts                     # Bot setup (polling/webhook)
├── handlers.ts                # Message/command handlers
├── approval.ts                # Approval via Telegram UI
├── media.ts                   # Attachment handling
├── rate_limit.ts              # Per-user rate limiting
└── formatting.ts              # Markdown formatting for Telegram
```

---

## Key Exports

```typescript
// src/channels/telegram/index.ts
export { TelegramChannel } from './index'
export { createTelegramBot, type TelegramBotConfig } from './bot'
```

---

## Implementation Requirements

### 1. Telegram Channel (index.ts)

```typescript
import { Telegraf, Context } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { randomUUID } from 'crypto'
import {
  Channel,
  ChannelMessage,
  ChannelResponse,
  ApprovalRequest,
} from '../types'

export interface TelegramChannelConfig {
  token: string
  ownerId: string  // Telegram user ID of owner
  ownerUuid: string  // Internal UUID for owner (from app config)
  allowedUsers?: string[]  // Additional allowed Telegram user IDs
  dmPolicy: 'owner_only' | 'allowlist' | 'anyone'
  webhookUrl?: string  // If set, use webhook mode
  rateLimit: {
    messagesPerMinute: number
    messagesPerHour: number
  }
}

export class TelegramChannel implements Channel {
  name = 'telegram'
  private bot: Telegraf
  private config: TelegramChannelConfig
  private messageHandler: ((msg: ChannelMessage) => Promise<ChannelResponse>) | null = null
  private pendingApprovals = new Map<string, {
    resolve: (approved: boolean) => void
    chatId: number
    messageId: number
    request: ApprovalRequest  // Store for "details" button
  }>()
  private userRateLimits = new Map<string, {
    minuteCount: number
    minuteResetAt: number
    hourCount: number
    hourResetAt: number
  }>()
  // Track current chat context for requestApproval()
  // Set during handleTextMessage, cleared after response
  private currentChatId: number | null = null
  // Stream buffering for simulated streaming
  private streamBuffer: Map<number, {
    content: string
    messageId: number | null
    lastUpdate: number
  }> = new Map()

  constructor(config: TelegramChannelConfig) {
    this.config = config
    this.bot = new Telegraf(config.token)
    this.setupHandlers()
  }

  async initialize(): Promise<void> {
    if (this.config.webhookUrl) {
      await this.bot.telegram.setWebhook(this.config.webhookUrl)
    } else {
      await this.bot.launch()
    }
  }

  async shutdown(): Promise<void> {
    this.bot.stop('SIGTERM')
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse>): void {
    this.messageHandler = handler
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    // Called during message handling - use tracked chat context
    if (this.currentChatId === null) {
      throw new Error('requestApproval called outside message handling context')
    }
    return this.requestApprovalInChat(request, this.currentChatId)
  }

  async requestApprovalInChat(
    request: ApprovalRequest,
    chatId: number
  ): Promise<boolean> {
    const requestId = randomUUID()

    return new Promise(async (resolve) => {
      // Format approval message
      const text = this.formatApprovalRequest(request)

      // Send with inline buttons
      const message = await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Allow', callback_data: `approve:${requestId}:yes` },
              { text: 'Deny', callback_data: `approve:${requestId}:no` },
            ],
            [
              { text: 'Show Details', callback_data: `approve:${requestId}:details` },
            ],
          ],
        },
      })

      // Store pending approval with request for "details" button
      this.pendingApprovals.set(requestId, {
        resolve,
        chatId,
        messageId: message.message_id,
        request,
      })

      // Timeout after 60 seconds
      setTimeout(() => {
        const pending = this.pendingApprovals.get(requestId)
        if (pending) {
          this.pendingApprovals.delete(requestId)
          this.updateApprovalMessage(chatId, pending.messageId, 'Approval timed out')
          resolve(false)
        }
      }, 60000)
    })
  }

  streamDelta(delta: string): void {
    // Telegram doesn't support true streaming
    // Buffer deltas and edit message periodically (throttled)
    if (this.currentChatId === null) return

    const chatId = this.currentChatId
    let buffer = this.streamBuffer.get(chatId)

    if (!buffer) {
      buffer = { content: '', messageId: null, lastUpdate: 0 }
      this.streamBuffer.set(chatId, buffer)
    }

    buffer.content += delta

    // Throttle updates to every 500ms to avoid Telegram rate limits
    const now = Date.now()
    if (now - buffer.lastUpdate < 500) return

    buffer.lastUpdate = now
    this.updateStreamMessage(chatId, buffer)
  }

  streamComplete(): void {
    // Send final buffered response
    if (this.currentChatId === null) return

    const chatId = this.currentChatId
    const buffer = this.streamBuffer.get(chatId)

    if (buffer && buffer.content) {
      this.updateStreamMessage(chatId, buffer, true)
    }

    this.streamBuffer.delete(chatId)
  }

  private async updateStreamMessage(
    chatId: number,
    buffer: { content: string; messageId: number | null; lastUpdate: number },
    final = false
  ): Promise<void> {
    try {
      const text = buffer.content + (final ? '' : ' ▌')  // Cursor indicator

      if (buffer.messageId === null) {
        // Send initial message
        const msg = await this.bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
        })
        buffer.messageId = msg.message_id
      } else {
        // Edit existing message
        await this.bot.telegram.editMessageText(
          chatId,
          buffer.messageId,
          undefined,
          text,
          { parse_mode: 'Markdown' }
        )
      }
    } catch {
      // Telegram may reject edits that don't change content
    }
  }

  onToolCallStart(name: string, summary?: string): void {
    // Could send a status message, but it's noisy
    // Better to show in final response
  }

  onToolCallResult(name: string, success: boolean): void {
    // Could update status, but handled in response
  }

  private setupHandlers(): void {
    // Handle text messages
    this.bot.on('text', async (ctx) => {
      await this.handleTextMessage(ctx)
    })

    // Handle callback queries (approval buttons)
    this.bot.on('callback_query', async (ctx) => {
      await this.handleCallbackQuery(ctx)
    })

    // Handle commands
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        'Welcome to meao! Send me a message to get started.\n\n' +
        'Commands:\n' +
        '/help - Show help\n' +
        '/clear - Clear conversation history'
      )
    })

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        'meao is your personal AI assistant.\n\n' +
        'Just send a message to chat. I can:\n' +
        '- Browse the web\n' +
        '- Execute commands\n' +
        '- Remember context\n\n' +
        'Some actions require your approval for safety.'
      )
    })

    this.bot.command('clear', async (ctx) => {
      // Clear session history
      const userId = ctx.from?.id.toString()
      if (userId) {
        // Clear via session manager
        await ctx.reply('Conversation cleared.')
      }
    })
  }

  private async handleTextMessage(ctx: Context): Promise<void> {
    const message = ctx.message as Message.TextMessage
    const userId = ctx.from?.id.toString()
    const chatId = ctx.chat?.id

    if (!userId || !chatId || !message.text) {
      return
    }

    // Check authorization
    if (!this.isAuthorized(userId)) {
      await ctx.reply('Sorry, you are not authorized to use this bot.')
      return
    }

    // Check rate limit
    if (!this.checkRateLimit(userId)) {
      await ctx.reply('Rate limit exceeded. Please wait before sending more messages.')
      return
    }

    if (!this.messageHandler) {
      await ctx.reply('Bot is not ready. Please try again later.')
      return
    }

    // Show typing indicator
    await ctx.sendChatAction('typing')

    // Set current chat context for requestApproval() and streaming
    this.currentChatId = chatId

    try {
      // Create channel message
      const channelMessage: ChannelMessage = {
        id: randomUUID(),
        userId: this.mapTelegramToUserId(userId),
        content: message.text,
        timestamp: new Date(message.date * 1000),
      }

      // Handle via orchestrator (uses this channel directly)
      const response = await this.messageHandler(channelMessage)

      // Send response (if not already sent via streaming)
      if (!this.streamBuffer.has(chatId)) {
        await this.sendResponse(ctx, response)
      }

    } catch (error) {
      console.error('Telegram message handling error:', error)
      await ctx.reply('An error occurred. Please try again.')
    } finally {
      // Clear chat context
      this.currentChatId = null
      this.streamBuffer.delete(chatId)
    }
  }

  private async handleCallbackQuery(ctx: Context): Promise<void> {
    const callbackQuery = ctx.callbackQuery
    if (!callbackQuery || !('data' in callbackQuery)) {
      return
    }

    const data = callbackQuery.data
    const [action, requestId, choice] = data.split(':')

    if (action !== 'approve') {
      return
    }

    const pending = this.pendingApprovals.get(requestId)
    if (!pending) {
      await ctx.answerCbQuery('This approval has expired.')
      return
    }

    if (choice === 'details') {
      // Show full request details
      const detailsText = this.formatApprovalDetails(pending.request)
      await this.bot.telegram.sendMessage(pending.chatId, detailsText, {
        parse_mode: 'Markdown',
        reply_to_message_id: pending.messageId,
      })
      await ctx.answerCbQuery('Details sent.')
      return
    }

    const approved = choice === 'yes'
    this.pendingApprovals.delete(requestId)

    // Update message
    const resultText = approved ? 'Approved' : 'Denied'
    await this.updateApprovalMessage(
      pending.chatId,
      pending.messageId,
      `Decision: ${resultText}`
    )

    await ctx.answerCbQuery(resultText)
    pending.resolve(approved)
  }

  private isAuthorized(telegramUserId: string): boolean {
    switch (this.config.dmPolicy) {
      case 'owner_only':
        return telegramUserId === this.config.ownerId

      case 'allowlist':
        return (
          telegramUserId === this.config.ownerId ||
          this.config.allowedUsers?.includes(telegramUserId) === true
        )

      case 'anyone':
        return true

      default:
        return false
    }
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now()
    let limit = this.userRateLimits.get(userId)

    // Initialize or reset expired buckets
    if (!limit) {
      limit = {
        minuteCount: 0,
        minuteResetAt: now + 60_000,
        hourCount: 0,
        hourResetAt: now + 3600_000,
      }
      this.userRateLimits.set(userId, limit)
    }

    // Reset minute bucket if expired
    if (limit.minuteResetAt < now) {
      limit.minuteCount = 0
      limit.minuteResetAt = now + 60_000
    }

    // Reset hour bucket if expired
    if (limit.hourResetAt < now) {
      limit.hourCount = 0
      limit.hourResetAt = now + 3600_000
    }

    // Check both limits
    if (limit.minuteCount >= this.config.rateLimit.messagesPerMinute) {
      return false
    }
    if (limit.hourCount >= this.config.rateLimit.messagesPerHour) {
      return false
    }

    // Increment both counters
    limit.minuteCount++
    limit.hourCount++
    return true
  }

  private mapTelegramToUserId(telegramUserId: string): string {
    // Map Telegram user ID to internal user ID
    // For owner, use the configured owner UUID
    if (telegramUserId === this.config.ownerId) {
      return this.config.ownerUuid
    }
    return `telegram:${telegramUserId}`
  }

  private async sendResponse(ctx: Context, response: ChannelResponse): Promise<void> {
    // Format response for Telegram
    const text = this.formatResponse(response)

    // Telegram has a 4096 character limit
    if (text.length <= 4096) {
      await ctx.reply(text, { parse_mode: 'Markdown' })
    } else {
      // Split into chunks
      const chunks = this.splitMessage(text, 4000)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' })
      }
    }
  }

  private formatApprovalRequest(request: ApprovalRequest): string {
    let text = `*Approval Required*\n\n`
    text += `Tool: \`${request.tool}\`\n`
    text += `Action: ${request.summary}\n`

    if (request.risks.length > 0) {
      text += `\n*Risks:*\n`
      for (const risk of request.risks) {
        text += `- ${risk}\n`
      }
    }

    return text
  }

  private formatApprovalDetails(request: ApprovalRequest): string {
    let text = `*Full Details*\n\n`
    text += `Tool: \`${request.tool}\`\n`
    text += `Summary: ${request.summary}\n`

    if (request.risks.length > 0) {
      text += `\n*Risks:*\n`
      for (const risk of request.risks) {
        text += `- ${risk}\n`
      }
    }

    // Show input parameters if available
    if ('input' in request && request.input) {
      text += `\n*Input:*\n`
      text += `\`\`\`json\n${JSON.stringify(request.input, null, 2)}\n\`\`\``
    }

    return text
  }

  private formatResponse(response: ChannelResponse): string {
    let text = response.content

    if (response.toolCalls && response.toolCalls.length > 0) {
      text += '\n\n_Tools used:_\n'
      for (const call of response.toolCalls) {
        const icon = call.success ? '' : ''
        text += `${icon} ${call.name}\n`
      }
    }

    return text
  }

  private async updateApprovalMessage(
    chatId: number,
    messageId: number,
    newText: string
  ): Promise<void> {
    try {
      await this.bot.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        newText,
        { parse_mode: 'Markdown' }
      )
    } catch {
      // Message may have been deleted
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining)
        break
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf('\n', maxLength)
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength)
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength
      }

      chunks.push(remaining.slice(0, breakPoint))
      remaining = remaining.slice(breakPoint).trimStart()
    }

    return chunks
  }
}
```

### 2. Bot Setup (bot.ts)

```typescript
import { Telegraf } from 'telegraf'
import { TelegramChannel, TelegramChannelConfig } from './index'
import { Orchestrator } from '../../orchestrator'

export interface TelegramBotConfig extends TelegramChannelConfig {
  orchestrator: Orchestrator
}

export async function createTelegramBot(
  config: TelegramBotConfig
): Promise<TelegramChannel> {
  const channel = new TelegramChannel(config)

  // Connect to orchestrator
  channel.onMessage(async (message) => {
    const session = await getOrCreateSession(message.userId, 'telegram')
    await config.orchestrator.handleMessage(message, channel, session)
    return { content: '', toolCalls: [] }  // Response sent via channel
  })

  await channel.initialize()

  return channel
}
```

### 3. Media Handling (media.ts)

```typescript
import { Context } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { Attachment } from '../types'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

// Download files server-side to avoid exposing token-bearing URLs
const ATTACHMENT_DIR = process.env.MEAO_ATTACHMENT_DIR ?? '/tmp/meao-attachments'

export async function extractAttachments(
  ctx: Context,
  message: Message,
  botToken: string
): Promise<Attachment[]> {
  const attachments: Attachment[] = []

  // Ensure attachment directory exists
  await mkdir(ATTACHMENT_DIR, { recursive: true })

  // Handle photos
  if ('photo' in message && message.photo) {
    const photo = message.photo[message.photo.length - 1]  // Highest resolution
    const file = await ctx.telegram.getFile(photo.file_id)

    if (file.file_path) {
      const localPath = await downloadFile(
        botToken,
        file.file_path,
        `photo_${randomUUID()}.jpg`
      )

      attachments.push({
        type: 'image',
        name: `photo_${photo.file_id}.jpg`,
        localPath,  // Use local path, not token-bearing URL
      })
    }
  }

  // Handle documents
  if ('document' in message && message.document) {
    const doc = message.document
    const file = await ctx.telegram.getFile(doc.file_id)

    if (file.file_path) {
      const fileName = doc.file_name ?? `document_${randomUUID()}`
      const localPath = await downloadFile(botToken, file.file_path, fileName)

      attachments.push({
        type: 'file',
        name: fileName,
        localPath,  // Use local path, not token-bearing URL
      })
    }
  }

  return attachments
}

async function downloadFile(
  botToken: string,
  filePath: string,
  fileName: string
): Promise<string> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const localPath = join(ATTACHMENT_DIR, fileName)

  await writeFile(localPath, Buffer.from(buffer))

  return localPath
}
```

### 4. Formatting (formatting.ts)

```typescript
// Telegram uses a subset of Markdown
// Need to escape special characters

const SPECIAL_CHARS = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']

export function escapeMarkdown(text: string): string {
  let escaped = text
  for (const char of SPECIAL_CHARS) {
    escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`)
  }
  return escaped
}

export function formatCode(code: string, language?: string): string {
  if (language) {
    return `\`\`\`${language}\n${code}\n\`\`\``
  }
  return `\`\`\`\n${code}\n\`\`\``
}

export function formatInlineCode(code: string): string {
  return `\`${code}\``
}

export function formatBold(text: string): string {
  return `*${text}*`
}

export function formatItalic(text: string): string {
  return `_${text}_`
}

export function formatLink(text: string, url: string): string {
  return `[${text}](${url})`
}
```

---

## Tests

```
test/channels/telegram/
├── index.test.ts              # TelegramChannel
├── bot.test.ts                # Bot setup
├── handlers.test.ts           # Message handlers
├── approval.test.ts           # Approval flow
├── media.test.ts              # Media handling
├── rate_limit.test.ts         # Rate limiting
└── formatting.test.ts         # Markdown formatting
```

### Critical Test Cases

```typescript
// test/channels/telegram/index.test.ts
describe('TelegramChannel', () => {
  const OWNER_UUID = '550e8400-e29b-41d4-a716-446655440000'

  it('rejects unauthorized users in owner_only mode', async () => {
    const channel = new TelegramChannel({
      token: 'test-token',
      ownerId: 'owner-123',
      ownerUuid: OWNER_UUID,
      dmPolicy: 'owner_only',
      rateLimit: { messagesPerMinute: 10, messagesPerHour: 100 },
    })

    const isAuthorized = channel['isAuthorized']('other-user-456')
    expect(isAuthorized).toBe(false)
  })

  it('allows owner in owner_only mode', async () => {
    const channel = new TelegramChannel({
      token: 'test-token',
      ownerId: 'owner-123',
      ownerUuid: OWNER_UUID,
      dmPolicy: 'owner_only',
      rateLimit: { messagesPerMinute: 10, messagesPerHour: 100 },
    })

    const isAuthorized = channel['isAuthorized']('owner-123')
    expect(isAuthorized).toBe(true)
  })

  it('maps owner Telegram ID to internal UUID', () => {
    const channel = new TelegramChannel({
      token: 'test-token',
      ownerId: 'owner-123',
      ownerUuid: OWNER_UUID,
      dmPolicy: 'owner_only',
      rateLimit: { messagesPerMinute: 10, messagesPerHour: 100 },
    })

    expect(channel['mapTelegramToUserId']('owner-123')).toBe(OWNER_UUID)
    expect(channel['mapTelegramToUserId']('other-456')).toBe('telegram:other-456')
  })

  it('allows allowlisted users', async () => {
    const channel = new TelegramChannel({
      token: 'test-token',
      ownerId: 'owner-123',
      ownerUuid: OWNER_UUID,
      allowedUsers: ['friend-456'],
      dmPolicy: 'allowlist',
      rateLimit: { messagesPerMinute: 10, messagesPerHour: 100 },
    })

    expect(channel['isAuthorized']('friend-456')).toBe(true)
    expect(channel['isAuthorized']('stranger-789')).toBe(false)
  })
})

// test/channels/telegram/approval.test.ts
describe('Telegram approval', () => {
  it('formats approval request correctly', () => {
    const channel = createTestTelegramChannel()
    const formatted = channel['formatApprovalRequest']({
      tool: 'bash',
      summary: 'Execute rm command',
      risks: ['Deletes files', 'Cannot be undone'],
    })

    expect(formatted).toContain('*Approval Required*')
    expect(formatted).toContain('`bash`')
    expect(formatted).toContain('Deletes files')
  })

  it('resolves approval on button click', async () => {
    const channel = createTestTelegramChannel()
    const mockBot = channel['bot']

    // Start approval request
    const approvalPromise = channel.requestApprovalInChat(
      { tool: 'bash', summary: 'Test', risks: [] },
      12345
    )

    // Simulate button click
    const requestId = [...channel['pendingApprovals'].keys()][0]
    channel['pendingApprovals'].get(requestId)?.resolve(true)

    const result = await approvalPromise
    expect(result).toBe(true)
  })
})

// test/channels/telegram/rate_limit.test.ts
describe('Rate limiting', () => {
  const makeConfig = () => ({
    token: 'test-token',
    ownerId: 'owner-123',
    ownerUuid: '550e8400-e29b-41d4-a716-446655440000',
    dmPolicy: 'owner_only' as const,
    rateLimit: { messagesPerMinute: 5, messagesPerHour: 10 },
  })

  it('allows messages within limit', () => {
    const channel = new TelegramChannel(makeConfig())

    for (let i = 0; i < 5; i++) {
      expect(channel['checkRateLimit']('user-1')).toBe(true)
    }
  })

  it('blocks messages over per-minute limit', () => {
    const channel = new TelegramChannel(makeConfig())

    for (let i = 0; i < 5; i++) {
      channel['checkRateLimit']('user-1')
    }

    expect(channel['checkRateLimit']('user-1')).toBe(false)
  })

  it('blocks messages over per-hour limit', () => {
    vi.useFakeTimers()
    const channel = new TelegramChannel(makeConfig())

    // Send 5 messages (hits minute limit)
    for (let i = 0; i < 5; i++) {
      channel['checkRateLimit']('user-1')
    }
    expect(channel['checkRateLimit']('user-1')).toBe(false)

    // Wait for minute reset
    vi.advanceTimersByTime(61_000)

    // Send 5 more (now at 10 total for the hour)
    for (let i = 0; i < 5; i++) {
      channel['checkRateLimit']('user-1')
    }

    // Wait for minute reset again
    vi.advanceTimersByTime(61_000)

    // Should be blocked by hour limit (10 messages already)
    expect(channel['checkRateLimit']('user-1')).toBe(false)

    vi.useRealTimers()
  })

  it('resets minute limit after 1 minute', () => {
    vi.useFakeTimers()
    const channel = new TelegramChannel(makeConfig())

    for (let i = 0; i < 5; i++) {
      channel['checkRateLimit']('user-1')
    }
    expect(channel['checkRateLimit']('user-1')).toBe(false)

    vi.advanceTimersByTime(61_000)  // 61 seconds
    expect(channel['checkRateLimit']('user-1')).toBe(true)

    vi.useRealTimers()
  })

  it('resets hour limit after 1 hour', () => {
    vi.useFakeTimers()
    const channel = new TelegramChannel(makeConfig())

    // Hit the hour limit (10 messages across multiple minutes)
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 5; j++) {
        channel['checkRateLimit']('user-1')
      }
      vi.advanceTimersByTime(61_000)
    }

    // Now blocked by hour limit
    expect(channel['checkRateLimit']('user-1')).toBe(false)

    // Advance past hour reset
    vi.advanceTimersByTime(3600_000)
    expect(channel['checkRateLimit']('user-1')).toBe(true)

    vi.useRealTimers()
  })
})

// test/channels/telegram/formatting.test.ts
describe('Markdown formatting', () => {
  it('escapes special characters', () => {
    const text = 'Hello *world* and _test_'
    const escaped = escapeMarkdown(text)
    expect(escaped).toBe('Hello \\*world\\* and \\_test\\_')
  })

  it('formats code blocks', () => {
    const code = 'console.log("hello")'
    const formatted = formatCode(code, 'javascript')
    expect(formatted).toBe('```javascript\nconsole.log("hello")\n```')
  })
})
```

---

## Definition of Done

- [ ] Telegram bot connects and receives messages
- [ ] Bot responds to /start, /help, /clear commands
- [ ] Text messages routed through orchestrator
- [ ] Responses sent back to users (with chunking for long messages)
- [ ] Approval prompts work via inline buttons
- [ ] Approval timeout works (60 seconds)
- [ ] DM policy enforced (owner_only by default)
- [ ] Rate limiting per user works
- [ ] Media attachments extracted and available to tools
- [ ] Markdown formatting works correctly
- [ ] All tests pass
- [ ] `pnpm check` passes

---

## Configuration

Add to config.json:

```json
{
  "owner": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": { "$ref": "credential:telegram_bot_token" },
      "ownerId": "123456789",
      "ownerUuid": { "$ref": "owner.id" },
      "dmPolicy": "owner_only",
      "rateLimit": {
        "messagesPerMinute": 10,
        "messagesPerHour": 100
      }
    }
  }
}
```

---

## Dependencies to Add

```bash
pnpm add telegraf
```

---

## Security Considerations

1. **DM Policy**: Default to `owner_only` to prevent unauthorized access
2. **Rate Limiting**: Per-user to prevent abuse
3. **Token Security**: Store bot token in encrypted credential store
4. **Approval Timeout**: 60-second timeout prevents hanging approvals
5. **Message Validation**: Validate incoming messages before processing

---

## Next Steps

After completing M11, the core multi-channel architecture is validated. Future channels (Discord, Slack) follow the same pattern.

---

*Last updated: 2026-01-29*
