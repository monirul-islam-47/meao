import { z } from 'zod'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import type { ToolPlugin, ToolOutput, ToolContext } from '../types.js'

/**
 * Write file tool - writes content to a file.
 */
export const writeTool: ToolPlugin = {
  name: 'write',
  description: 'Write content to a file',
  parameters: z.object({
    path: z.string().describe('Path to the file to write'),
    content: z.string().describe('Content to write'),
    encoding: z
      .enum(['utf-8', 'utf8', 'ascii', 'base64'])
      .optional()
      .default('utf-8')
      .describe('File encoding'),
    createDirectories: z
      .boolean()
      .optional()
      .default(true)
      .describe('Create parent directories if they do not exist'),
  }),
  capability: {
    name: 'write',
    approval: {
      level: 'ask', // Always ask before writing files
    },
    execution: {
      sandbox: 'process',
      networkDefault: 'none',
    },
    labels: {
      outputTrust: 'verified',
      outputDataClass: 'internal',
      acceptsUntrusted: false, // Don't write untrusted content without approval
    },
    audit: {
      logArgs: true, // Log file path
      logOutput: false, // File contents not logged
    },
  },
  actions: [
    {
      tool: 'write',
      action: 'write',
      affectsOthers: false,
      isDestructive: true, // Overwrites existing files
      hasFinancialImpact: false,
    },
  ],
  async execute(args: unknown, context: ToolContext): Promise<ToolOutput> {
    const { path: filePath, content, encoding, createDirectories } = args as {
      path: string
      content: string
      encoding: BufferEncoding
      createDirectories: boolean
    }

    try {
      // Resolve path relative to working directory
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(context.workDir, filePath)

      // Create parent directories if needed
      if (createDirectories) {
        await mkdir(path.dirname(resolvedPath), { recursive: true })
      }

      await writeFile(resolvedPath, content, encoding)

      return {
        success: true,
        output: `Successfully wrote ${content.length} bytes to ${resolvedPath}`,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error writing file'
      return {
        success: false,
        output: `Error writing file: ${message}`,
      }
    }
  },
}
