/**
 * Fact Extraction (Stub)
 *
 * Future implementation for extracting structured facts from conversation text.
 * This will use LLM-based extraction to identify:
 * - User preferences
 * - Entity information
 * - Relationships between entities
 * - Instructions or constraints
 */

import type { FactType } from '../types.js'

/**
 * Extracted fact from text.
 */
export interface ExtractedFact {
  factType: FactType
  subject: string
  predicate: string
  object: string
  confidence: number
  evidence: string
}

/**
 * Configuration for fact extraction.
 */
export interface ExtractionConfig {
  minConfidence: number
  maxFacts: number
  factTypes: FactType[]
}

/**
 * Default extraction configuration.
 */
export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  minConfidence: 0.7,
  maxFacts: 5,
  factTypes: ['preference', 'entity', 'relationship', 'instruction'],
}

/**
 * Extract facts from text.
 *
 * Stub implementation - returns empty array.
 * Future implementation will use LLM to extract structured facts.
 *
 * @param text - Text to extract facts from
 * @param config - Extraction configuration
 * @returns Extracted facts (empty for stub)
 */
export async function extractFacts(
  _text: string,
  _config: ExtractionConfig = DEFAULT_EXTRACTION_CONFIG
): Promise<ExtractedFact[]> {
  // TODO: Implement LLM-based fact extraction
  // This would:
  // 1. Send text to LLM with structured output format
  // 2. Parse response into ExtractedFact objects
  // 3. Filter by confidence threshold
  // 4. Return up to maxFacts

  return []
}

/**
 * Validate extracted fact.
 *
 * Checks that a fact has valid subject, predicate, and object.
 *
 * @param fact - Fact to validate
 * @returns True if valid
 */
export function validateFact(fact: ExtractedFact): boolean {
  if (!fact.subject || fact.subject.trim().length === 0) return false
  if (!fact.predicate || fact.predicate.trim().length === 0) return false
  if (!fact.object || fact.object.trim().length === 0) return false
  if (fact.confidence < 0 || fact.confidence > 1) return false
  return true
}
