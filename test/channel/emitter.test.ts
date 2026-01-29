import { describe, it, expect, vi } from 'vitest'
import { TypedEventEmitter } from '../../src/channel/emitter.js'

describe('TypedEventEmitter', () => {
  it('emits message events', () => {
    const emitter = new TypedEventEmitter()
    const listener = vi.fn()

    emitter.on('message', listener)
    emitter.emit('message', {
      type: 'user_message',
      id: '1',
      timestamp: new Date(),
      sessionId: 'test',
      content: 'hello',
    } as any)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hello' })
    )
  })

  it('removes listeners with off', () => {
    const emitter = new TypedEventEmitter()
    const listener = vi.fn()

    emitter.on('message', listener)
    emitter.off('message', listener)
    emitter.emit('message', {} as any)

    expect(listener).not.toHaveBeenCalled()
  })

  it('supports multiple listeners', () => {
    const emitter = new TypedEventEmitter()
    const listener1 = vi.fn()
    const listener2 = vi.fn()

    emitter.on('message', listener1)
    emitter.on('message', listener2)
    emitter.emit('message', {} as any)

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
  })

  it('supports once for single-fire listeners', () => {
    const emitter = new TypedEventEmitter()
    const listener = vi.fn()

    emitter.once('message', listener)
    emitter.emit('message', {} as any)
    emitter.emit('message', {} as any)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('handles stateChange events', () => {
    const emitter = new TypedEventEmitter()
    const listener = vi.fn()

    emitter.on('stateChange', listener)
    emitter.emit('stateChange', 'connected')

    expect(listener).toHaveBeenCalledWith('connected')
  })

  it('handles error events', () => {
    const emitter = new TypedEventEmitter()
    const listener = vi.fn()
    const error = new Error('test error')

    emitter.on('error', listener)
    emitter.emit('error', error)

    expect(listener).toHaveBeenCalledWith(error)
  })

  it('removeAllListeners removes all for an event', () => {
    const emitter = new TypedEventEmitter()
    const listener1 = vi.fn()
    const listener2 = vi.fn()

    emitter.on('message', listener1)
    emitter.on('message', listener2)
    emitter.removeAllListeners('message')
    emitter.emit('message', {} as any)

    expect(listener1).not.toHaveBeenCalled()
    expect(listener2).not.toHaveBeenCalled()
  })

  it('removeAllListeners removes all events when no arg', () => {
    const emitter = new TypedEventEmitter()
    const listener1 = vi.fn()
    const listener2 = vi.fn()

    emitter.on('message', listener1)
    emitter.on('stateChange', listener2)
    emitter.removeAllListeners()
    emitter.emit('message', {} as any)
    emitter.emit('stateChange', 'connected')

    expect(listener1).not.toHaveBeenCalled()
    expect(listener2).not.toHaveBeenCalled()
  })

  it('listenerCount returns correct count', () => {
    const emitter = new TypedEventEmitter()

    expect(emitter.listenerCount('message')).toBe(0)

    emitter.on('message', () => {})
    emitter.on('message', () => {})

    expect(emitter.listenerCount('message')).toBe(2)
  })

  it('continues emitting if one listener throws', () => {
    const emitter = new TypedEventEmitter()
    const errorListener = vi.fn(() => {
      throw new Error('listener error')
    })
    const successListener = vi.fn()

    // Silence console.error for this test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    emitter.on('message', errorListener)
    emitter.on('message', successListener)
    emitter.emit('message', {} as any)

    expect(errorListener).toHaveBeenCalled()
    expect(successListener).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
