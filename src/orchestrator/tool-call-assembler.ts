/**
 * ToolCallAssembler - Buffers streaming tool call deltas and produces complete tool calls.
 *
 * Handles:
 * - Tool call JSON split across multiple deltas
 * - Multiple tool calls in a single assistant message
 * - Partial/incomplete tool calls (stream abort)
 * - Validation of complete tool call JSON
 */

export interface PartialToolCall {
  id: string
  name: string
  inputJson: string // Accumulated JSON string
  complete: boolean
}

export interface AssembledToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AssemblerError {
  id: string
  error: string
  partialJson?: string
}

export type AssemblerResult =
  | { success: true; toolCall: AssembledToolCall }
  | { success: false; error: AssemblerError }

/**
 * Assembles streaming tool call deltas into complete tool calls.
 */
export class ToolCallAssembler {
  private partialCalls: Map<string, PartialToolCall> = new Map()
  private completedCalls: AssembledToolCall[] = []
  private errors: AssemblerError[] = []

  /**
   * Start a new tool call.
   */
  startToolCall(id: string, name: string): void {
    this.partialCalls.set(id, {
      id,
      name,
      inputJson: '',
      complete: false,
    })
  }

  /**
   * Add a delta to an in-progress tool call.
   */
  addDelta(id: string, jsonDelta: string): void {
    const partial = this.partialCalls.get(id)
    if (!partial) {
      // Tool call started without startToolCall - create it
      this.partialCalls.set(id, {
        id,
        name: 'unknown',
        inputJson: jsonDelta,
        complete: false,
      })
      return
    }

    partial.inputJson += jsonDelta
  }

  /**
   * Mark a tool call as complete and validate.
   */
  endToolCall(id: string): AssemblerResult {
    const partial = this.partialCalls.get(id)
    if (!partial) {
      const error: AssemblerError = {
        id,
        error: 'Tool call end without start',
      }
      this.errors.push(error)
      return { success: false, error }
    }

    partial.complete = true

    // Validate and parse JSON
    try {
      const input = JSON.parse(partial.inputJson || '{}')
      const toolCall: AssembledToolCall = {
        id: partial.id,
        name: partial.name,
        input,
      }
      this.completedCalls.push(toolCall)
      this.partialCalls.delete(id)
      return { success: true, toolCall }
    } catch (e) {
      const error: AssemblerError = {
        id,
        error: `Invalid tool call JSON: ${(e as Error).message}`,
        partialJson: partial.inputJson,
      }
      this.errors.push(error)
      this.partialCalls.delete(id)
      return { success: false, error }
    }
  }

  /**
   * Get all completed tool calls.
   */
  getCompletedCalls(): AssembledToolCall[] {
    return [...this.completedCalls]
  }

  /**
   * Get all errors.
   */
  getErrors(): AssemblerError[] {
    return [...this.errors]
  }

  /**
   * Check if there are any incomplete tool calls.
   */
  hasIncompleteCalls(): boolean {
    return this.partialCalls.size > 0
  }

  /**
   * Get incomplete call IDs.
   */
  getIncompleteCallIds(): string[] {
    return Array.from(this.partialCalls.keys())
  }

  /**
   * Fail all incomplete calls (e.g., on stream abort).
   */
  failIncompleteCalls(reason: string): AssemblerError[] {
    const failures: AssemblerError[] = []
    for (const [id, partial] of this.partialCalls) {
      const error: AssemblerError = {
        id,
        error: reason,
        partialJson: partial.inputJson,
      }
      this.errors.push(error)
      failures.push(error)
    }
    this.partialCalls.clear()
    return failures
  }

  /**
   * Reset the assembler for a new message.
   */
  reset(): void {
    this.partialCalls.clear()
    this.completedCalls = []
    this.errors = []
  }

  /**
   * Get current state for debugging.
   */
  getState(): {
    partial: PartialToolCall[]
    completed: AssembledToolCall[]
    errors: AssemblerError[]
  } {
    return {
      partial: Array.from(this.partialCalls.values()),
      completed: this.completedCalls,
      errors: this.errors,
    }
  }
}

/**
 * Create a new ToolCallAssembler.
 */
export function createToolCallAssembler(): ToolCallAssembler {
  return new ToolCallAssembler()
}
