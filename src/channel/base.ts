import { randomUUID } from 'crypto'
import type {
  Channel,
  ChannelMessage,
  ChannelState,
  MessageType,
  ChannelEvents,
} from './types.js'
import { TypedEventEmitter } from './emitter.js'

/**
 * Base channel implementation with common functionality.
 */
export abstract class BaseChannel extends TypedEventEmitter implements Channel {
  protected _state: ChannelState = 'disconnected'
  protected _sessionId: string

  constructor(sessionId?: string) {
    super()
    this._sessionId = sessionId ?? randomUUID()
  }

  get state(): ChannelState {
    return this._state
  }

  get sessionId(): string {
    return this._sessionId
  }

  /**
   * Send a message through the channel.
   */
  abstract send(message: ChannelMessage): Promise<void>

  /**
   * Connect the channel.
   */
  abstract connect(): Promise<void>

  /**
   * Disconnect the channel.
   */
  abstract disconnect(): Promise<void>

  /**
   * Wait for a specific message type.
   */
  async waitFor<T extends ChannelMessage>(
    type: MessageType,
    timeout = 30000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.off('message', handler)
        reject(new Error(`Timeout waiting for ${type} message`))
      }, timeout)

      const handler = (message: ChannelMessage) => {
        if (message.type === type) {
          clearTimeout(timeoutId)
          this.off('message', handler)
          resolve(message as T)
        }
      }

      this.on('message', handler)
    })
  }

  /**
   * Set channel state and emit event.
   */
  protected setState(state: ChannelState): void {
    if (this._state !== state) {
      this._state = state
      this.emit('stateChange', state)
    }
  }

  /**
   * Create a message with common fields.
   */
  protected createMessage<T extends ChannelMessage>(
    type: MessageType,
    fields: Omit<T, 'type' | 'id' | 'timestamp' | 'sessionId'>
  ): T {
    return {
      type,
      id: randomUUID(),
      timestamp: new Date(),
      sessionId: this._sessionId,
      ...fields,
    } as T
  }
}
