/**
 * Working Memory Compaction
 *
 * Stub for future history summarization functionality.
 * In Phase 3+, this will use an LLM to summarize older messages
 * to reduce token usage while preserving important context.
 */

import type { WorkingMessage } from '../types.js'

/**
 * Compaction strategy type.
 */
export type CompactionStrategy = 'truncate' | 'summarize'

/**
 * Compaction options.
 */
export interface CompactionOptions {
  strategy: CompactionStrategy
  targetTokens: number
  preserveSystemMessages: boolean
}

/**
 * Compact messages to reduce token usage.
 *
 * Current implementation: simple truncation (removes oldest first).
 * Future: LLM-based summarization.
 *
 * @param messages - Messages to compact
 * @param options - Compaction options
 * @returns Compacted messages
 */
export async function compactMessages(
  messages: WorkingMessage[],
  _options: CompactionOptions
): Promise<WorkingMessage[]> {
  // For now, just return messages as-is
  // Truncation is handled in WorkingMemory.enforceTokenLimit()
  // Summarization will be added in Phase 3+ (using _options)
  return messages
}

/**
 * Estimate tokens saved by compaction.
 *
 * @param original - Original messages
 * @param compacted - Compacted messages
 * @returns Tokens saved
 */
export function estimateSavings(
  original: WorkingMessage[],
  compacted: WorkingMessage[]
): number {
  const originalTokens = original.reduce((sum, m) => sum + (m.tokens ?? 0), 0)
  const compactedTokens = compacted.reduce((sum, m) => sum + (m.tokens ?? 0), 0)
  return originalTokens - compactedTokens
}
