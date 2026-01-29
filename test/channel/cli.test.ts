import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Writable } from 'stream'
import { CLIChannel } from '../../src/channel/cli.js'
import type {
  AssistantMessage,
  ErrorMessage,
  ChannelMessage,
} from '../../src/channel/types.js'

// Create mock streams
function createMockStreams() {
  const outputChunks: string[] = []
  const errorChunks: string[] = []

  // Use a mock that doesn't rely on actual readline
  const input = {
    on: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setEncoding: vi.fn(),
    read: vi.fn(),
    pipe: vi.fn(),
    unpipe: vi.fn(),
    unshift: vi.fn(),
    wrap: vi.fn(),
    [Symbol.asyncIterator]: vi.fn(),
    readable: true,
    readableEncoding: null,
    readableEnded: false,
    readableFlowing: null,
    readableHighWaterMark: 16384,
    readableLength: 0,
    readableObjectMode: false,
    destroyed: false,
    destroy: vi.fn(),
    isPaused: vi.fn(),
    off: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    emit: vi.fn(),
    prependListener: vi.fn(),
    prependOnceListener: vi.fn(),
    removeAllListeners: vi.fn(),
    setMaxListeners: vi.fn(),
    getMaxListeners: vi.fn(),
    listeners: vi.fn(),
    rawListeners: vi.fn(),
    listenerCount: vi.fn(),
    eventNames: vi.fn(),
    once: vi.fn(),
  }

  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputChunks.push(chunk.toString())
      callback()
    },
  })

  const error = new Writable({
    write(chunk, _encoding, callback) {
      errorChunks.push(chunk.toString())
      callback()
    },
  })

  return { input, output, error, outputChunks, errorChunks }
}

describe('CLIChannel', () => {
  describe('basic properties', () => {
    it('generates session ID if not provided', () => {
      const streams = createMockStreams()
      const channel = new CLIChannel({
        input: streams.input as any,
        output: streams.output,
      })
      expect(channel.sessionId).toBeDefined()
      expect(channel.sessionId.length).toBeGreaterThan(0)
    })

    it('uses provided session ID', () => {
      const streams = createMockStreams()
      const channel = new CLIChannel({
        sessionId: 'custom-session-id',
        input: streams.input as any,
        output: streams.output,
      })
      expect(channel.sessionId).toBe('custom-session-id')
    })

    it('starts disconnected', () => {
      const streams = createMockStreams()
      const channel = new CLIChannel({
        input: streams.input as any,
        output: streams.output,
      })
      expect(channel.state).toBe('disconnected')
    })
  })

  describe('output rendering', () => {
    let channel: CLIChannel
    let streams: ReturnType<typeof createMockStreams>

    beforeEach(async () => {
      streams = createMockStreams()
      channel = new CLIChannel({
        input: streams.input as any,
        output: streams.output,
        error: streams.error,
        colors: false,
      })
      // Manually set connected state for testing output
      ;(channel as any)._state = 'connected'
    })

    it('renders assistant message', async () => {
      await channel.send({
        type: 'assistant_message',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        content: 'Hello, I am Claude.',
      } as AssistantMessage)

      const output = streams.outputChunks.join('')
      expect(output).toContain('Hello, I am Claude.')
    })

    it('renders error message', async () => {
      await channel.send({
        type: 'error',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        code: 'TEST_ERROR',
        message: 'Something went wrong',
        recoverable: true,
      } as ErrorMessage)

      const output = streams.errorChunks.join('')
      expect(output).toContain('TEST_ERROR')
      expect(output).toContain('Something went wrong')
    })

    it('renders tool use', async () => {
      await channel.send({
        type: 'tool_use',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        name: 'read',
        args: { path: '/test/file.txt' },
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('read')
    })

    it('renders tool result', async () => {
      await channel.send({
        type: 'tool_result',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        name: 'read',
        success: true,
        output: 'file contents',
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('read')
      expect(output).toContain('file contents')
    })

    it('truncates long tool output', async () => {
      const longOutput = Array(20)
        .fill('line')
        .map((l, i) => `${l} ${i}`)
        .join('\n')

      await channel.send({
        type: 'tool_result',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        name: 'bash',
        success: true,
        output: longOutput,
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('more lines')
    })

    it('handles stream deltas', async () => {
      await channel.send({
        type: 'stream_start',
        id: 'stream-1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        streamId: 'stream-1',
      } as any)

      await channel.send({
        type: 'stream_delta',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        streamId: 'stream-1',
        delta: 'Hello',
      } as any)

      await channel.send({
        type: 'stream_delta',
        id: '2',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        streamId: 'stream-1',
        delta: ' World',
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('Hello')
      expect(output).toContain(' World')
    })
  })

  describe('system messages', () => {
    let channel: CLIChannel
    let streams: ReturnType<typeof createMockStreams>

    beforeEach(() => {
      streams = createMockStreams()
      channel = new CLIChannel({
        input: streams.input as any,
        output: streams.output,
        error: streams.error,
        colors: false,
      })
      ;(channel as any)._state = 'connected'
    })

    it('renders connected message', async () => {
      await channel.send({
        type: 'system',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        event: 'connected',
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('Connected')
    })

    it('renders disconnected message', async () => {
      await channel.send({
        type: 'system',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        event: 'disconnected',
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('Disconnected')
    })

    it('renders rate limited message', async () => {
      await channel.send({
        type: 'system',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        event: 'rate_limited',
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('Rate limited')
    })

    it('renders cost update', async () => {
      await channel.send({
        type: 'system',
        id: '1',
        timestamp: new Date(),
        sessionId: channel.sessionId,
        event: 'cost_update',
        data: { totalCost: 0.0123 },
      } as any)

      const output = streams.outputChunks.join('')
      expect(output).toContain('Cost')
      expect(output).toContain('0.0123')
    })
  })
})
