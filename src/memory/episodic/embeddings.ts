/**
 * Embedding Generator
 *
 * Generates vector embeddings for text content.
 * Supports:
 * - Mock embeddings (deterministic, for testing)
 * - OpenAI embeddings (stub for future)
 */

import { createHash } from 'crypto'

/**
 * Embedding generator interface.
 */
export interface IEmbeddingGenerator {
  generate(text: string): Promise<number[]>
  getDimensions(): number
}

/**
 * Embedding generator configuration.
 */
export interface EmbeddingGeneratorConfig {
  model: string
  dimensions?: number
}

/**
 * Create an embedding generator based on model string.
 *
 * @param config - Configuration with model string
 * @returns Embedding generator instance
 */
export function createEmbeddingGenerator(
  config: EmbeddingGeneratorConfig
): IEmbeddingGenerator {
  const model = config.model.toLowerCase()

  if (model === 'mock' || model.startsWith('mock:')) {
    return new MockEmbeddingGenerator(config.dimensions ?? 1536)
  }

  if (model.startsWith('openai:')) {
    // TODO: Implement OpenAI embeddings
    throw new Error('OpenAI embeddings not yet implemented')
  }

  throw new Error(`Unknown embedding model: ${config.model}`)
}

/**
 * Mock embedding generator for testing.
 *
 * Generates deterministic embeddings based on text hash.
 * Same text always produces same embedding.
 */
export class MockEmbeddingGenerator implements IEmbeddingGenerator {
  private dimensions: number
  private cache = new Map<string, number[]>()

  constructor(dimensions: number = 1536) {
    this.dimensions = dimensions
  }

  /**
   * Generate a deterministic embedding from text.
   *
   * Uses SHA-256 hash expanded to fill dimensions,
   * then normalizes to unit vector.
   */
  async generate(text: string): Promise<number[]> {
    // Check cache
    const cached = this.cache.get(text)
    if (cached) {
      return cached
    }

    // Generate deterministic embedding from hash
    const embedding = this.hashToEmbedding(text)

    // Normalize to unit vector
    const normalized = this.normalize(embedding)

    // Cache result
    this.cache.set(text, normalized)

    return normalized
  }

  getDimensions(): number {
    return this.dimensions
  }

  /**
   * Convert text to embedding using hash expansion.
   */
  private hashToEmbedding(text: string): number[] {
    const embedding: number[] = []

    // Generate enough hash bytes to fill dimensions
    let hashIndex = 0
    let currentHash = this.hash(text + hashIndex.toString())

    for (let i = 0; i < this.dimensions; i++) {
      // Get byte from hash
      const byteIndex = i % 32
      if (byteIndex === 0 && i > 0) {
        // Need new hash
        hashIndex++
        currentHash = this.hash(text + hashIndex.toString())
      }

      // Convert byte to float in [-1, 1]
      const byte = parseInt(currentHash.slice(byteIndex * 2, byteIndex * 2 + 2), 16)
      embedding.push((byte / 127.5) - 1)
    }

    return embedding
  }

  /**
   * Compute SHA-256 hash of text.
   */
  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  /**
   * Normalize vector to unit length.
   */
  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    if (magnitude === 0) return vec
    return vec.map((v) => v / magnitude)
  }
}

/**
 * Compute cosine similarity between two vectors.
 *
 * For unit vectors (normalized embeddings), this is just the dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length')
  }

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}
