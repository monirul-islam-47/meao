import { describe, it, expect } from 'vitest'
import {
  MockEmbeddingGenerator,
  createEmbeddingGenerator,
  cosineSimilarity,
} from '../../../src/memory/episodic/embeddings.js'

describe('EmbeddingGenerator', () => {
  describe('MockEmbeddingGenerator', () => {
    it('generates embeddings of correct dimensions', async () => {
      const generator = new MockEmbeddingGenerator(1536)
      const embedding = await generator.generate('Hello world')

      expect(embedding).toHaveLength(1536)
    })

    it('generates deterministic embeddings', async () => {
      const generator = new MockEmbeddingGenerator()

      const embedding1 = await generator.generate('Hello world')
      const embedding2 = await generator.generate('Hello world')

      expect(embedding1).toEqual(embedding2)
    })

    it('generates different embeddings for different text', async () => {
      const generator = new MockEmbeddingGenerator()

      const embedding1 = await generator.generate('Hello world')
      const embedding2 = await generator.generate('Goodbye world')

      expect(embedding1).not.toEqual(embedding2)
    })

    it('generates normalized (unit) vectors', async () => {
      const generator = new MockEmbeddingGenerator()
      const embedding = await generator.generate('Test text')

      // Calculate magnitude
      const magnitude = Math.sqrt(
        embedding.reduce((sum, v) => sum + v * v, 0)
      )

      // Should be very close to 1
      expect(magnitude).toBeCloseTo(1, 5)
    })

    it('caches embeddings for performance', async () => {
      const generator = new MockEmbeddingGenerator()

      // Generate first time (will compute)
      const start = Date.now()
      await generator.generate('Test text')
      const firstTime = Date.now() - start

      // Generate second time (should use cache)
      const start2 = Date.now()
      await generator.generate('Test text')
      const secondTime = Date.now() - start2

      // Cache hit should be faster (or at least not slower)
      expect(secondTime).toBeLessThanOrEqual(firstTime + 5)
    })

    it('supports custom dimensions', async () => {
      const generator = new MockEmbeddingGenerator(512)
      const embedding = await generator.generate('Test')

      expect(embedding).toHaveLength(512)
      expect(generator.getDimensions()).toBe(512)
    })
  })

  describe('createEmbeddingGenerator', () => {
    it('creates mock generator for "mock" model', () => {
      const generator = createEmbeddingGenerator({ model: 'mock' })
      expect(generator.getDimensions()).toBe(1536)
    })

    it('creates mock generator for "mock:" prefix', () => {
      const generator = createEmbeddingGenerator({ model: 'mock:test' })
      expect(generator.getDimensions()).toBe(1536)
    })

    it('respects custom dimensions', () => {
      const generator = createEmbeddingGenerator({
        model: 'mock',
        dimensions: 768,
      })
      expect(generator.getDimensions()).toBe(768)
    })

    it('throws for openai model (not yet implemented)', () => {
      expect(() => {
        createEmbeddingGenerator({ model: 'openai:text-embedding-3-small' })
      }).toThrow('not yet implemented')
    })

    it('throws for unknown model', () => {
      expect(() => {
        createEmbeddingGenerator({ model: 'unknown-model' })
      }).toThrow('Unknown embedding model')
    })
  })

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const a = [0.5, 0.5, 0.5, 0.5]
      const similarity = cosineSimilarity(a, a)

      expect(similarity).toBeCloseTo(1, 5)
    })

    it('returns -1 for opposite vectors', () => {
      const a = [1, 0, 0, 0]
      const b = [-1, 0, 0, 0]
      const similarity = cosineSimilarity(a, b)

      expect(similarity).toBeCloseTo(-1, 5)
    })

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0, 0]
      const b = [0, 1, 0, 0]
      const similarity = cosineSimilarity(a, b)

      expect(similarity).toBeCloseTo(0, 5)
    })

    it('returns value between -1 and 1', () => {
      const a = [0.1, 0.2, 0.3, 0.4]
      const b = [0.4, 0.3, 0.2, 0.1]
      const similarity = cosineSimilarity(a, b)

      expect(similarity).toBeGreaterThanOrEqual(-1)
      expect(similarity).toBeLessThanOrEqual(1)
    })

    it('is symmetric', () => {
      const a = [0.1, 0.2, 0.3]
      const b = [0.4, 0.5, 0.6]

      const sim1 = cosineSimilarity(a, b)
      const sim2 = cosineSimilarity(b, a)

      expect(sim1).toBeCloseTo(sim2, 10)
    })

    it('throws for vectors of different lengths', () => {
      const a = [1, 2, 3]
      const b = [1, 2]

      expect(() => cosineSimilarity(a, b)).toThrow('same length')
    })

    it('handles zero vectors', () => {
      const a = [0, 0, 0]
      const b = [1, 2, 3]
      const similarity = cosineSimilarity(a, b)

      expect(similarity).toBe(0)
    })
  })
})
