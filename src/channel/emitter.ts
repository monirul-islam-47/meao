import type { ChannelEvents, ChannelEventEmitter } from './types.js'

/**
 * Simple typed event emitter for channels.
 */
export class TypedEventEmitter implements ChannelEventEmitter {
  private listeners = new Map<keyof ChannelEvents, Set<(...args: any[]) => void>>()

  /**
   * Add event listener.
   */
  on<K extends keyof ChannelEvents>(event: K, listener: ChannelEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof ChannelEvents>(event: K, listener: ChannelEvents[K]): void {
    this.listeners.get(event)?.delete(listener)
  }

  /**
   * Emit an event.
   */
  emit<K extends keyof ChannelEvents>(
    event: K,
    ...args: Parameters<ChannelEvents[K]>
  ): void {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(...args)
        } catch (error) {
          // Don't let one listener's error affect others
          console.error(`Error in ${event} listener:`, error)
        }
      }
    }
  }

  /**
   * Add a one-time listener.
   */
  once<K extends keyof ChannelEvents>(event: K, listener: ChannelEvents[K]): void {
    const wrapper = ((...args: Parameters<ChannelEvents[K]>) => {
      this.off(event, wrapper as ChannelEvents[K])
      ;(listener as (...args: any[]) => void)(...args)
    }) as ChannelEvents[K]

    this.on(event, wrapper)
  }

  /**
   * Remove all listeners for an event.
   */
  removeAllListeners(event?: keyof ChannelEvents): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
    }
  }

  /**
   * Get listener count for an event.
   */
  listenerCount(event: keyof ChannelEvents): number {
    return this.listeners.get(event)?.size ?? 0
  }
}
