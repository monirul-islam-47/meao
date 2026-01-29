import { z } from 'zod'
import { readFile } from 'fs/promises'
import path from 'path'
import type { ToolPlugin, ToolOutput, ToolContext } from '../types.js'

/**
 * Read file tool - reads file contents.
 */
export const readTool: ToolPlugin = {
  name: 'read',
  description: 'Read the contents of a file',
  parameters: z.object({
    path: z.string().describe('Path to the file to read'),
    encoding: z
      .enum(['utf-8', 'utf8', 'ascii', 'base64'])
      .optional()
      .default('utf-8')
      .describe('File encoding'),
  }),
  capability: {
    name: 'read',
    approval: {
      level: 'auto',
    },
    execution: {
      sandbox: 'process',
      networkDefault: 'none',
    },
    labels: {
      outputTrust: 'user',
      outputDataClass: 'internal',
      acceptsUntrusted: true,
    },
    audit: {
      logArgs: true,
      logOutput: false, // File contents not logged
    },
  },
  actions: [
    {
      tool: 'read',
      action: 'read',
      affectsOthers: false,
      isDestructive: false,
      hasFinancialImpact: false,
    },
  ],
  async execute(args: unknown, context: ToolContext): Promise<ToolOutput> {
    const { path: filePath, encoding } = args as {
      path: string
      encoding: BufferEncoding
    }

    try {
      // Resolve path relative to working directory
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(context.workDir, filePath)

      const content = await readFile(resolvedPath, encoding)

      return {
        success: true,
        output: content,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error reading file'
      return {
        success: false,
        output: `Error reading file: ${message}`,
      }
    }
  },
}
