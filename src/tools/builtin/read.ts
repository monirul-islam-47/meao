import { z } from 'zod'
import { readFile, realpath } from 'fs/promises'
import path from 'path'
import type { ToolPlugin, ToolOutput, ToolContext } from '../types.js'

/**
 * Securely resolve a path within a working directory.
 * Blocks:
 * - Absolute paths outside workDir
 * - Path traversal (../)
 * - Symlink escapes
 */
async function resolveSecurePath(
  filePath: string,
  workDir: string
): Promise<{ safe: boolean; resolvedPath: string; error?: string }> {
  // Normalize the working directory
  const normalizedWorkDir = path.resolve(workDir)

  // Resolve the file path
  let resolvedPath: string
  if (path.isAbsolute(filePath)) {
    resolvedPath = path.normalize(filePath)
  } else {
    resolvedPath = path.resolve(normalizedWorkDir, filePath)
  }

  // Check if resolved path is within workDir (before following symlinks)
  if (!resolvedPath.startsWith(normalizedWorkDir + path.sep) && resolvedPath !== normalizedWorkDir) {
    return {
      safe: false,
      resolvedPath,
      error: 'Access denied: path outside working directory',
    }
  }

  // Follow symlinks and check again (prevents symlink escape attacks)
  try {
    const realPath = await realpath(resolvedPath)
    if (!realPath.startsWith(normalizedWorkDir + path.sep) && realPath !== normalizedWorkDir) {
      return {
        safe: false,
        resolvedPath: realPath,
        error: 'Access denied: symlink points outside working directory',
      }
    }
    return { safe: true, resolvedPath: realPath }
  } catch (error) {
    // File doesn't exist yet (for write) or permission denied
    // For read, we'll let the actual read fail with appropriate error
    return { safe: true, resolvedPath }
  }
}

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
      // Securely resolve path within working directory
      const { safe, resolvedPath, error } = await resolveSecurePath(
        filePath,
        context.workDir
      )

      if (!safe) {
        return {
          success: false,
          output: error || 'Access denied',
        }
      }

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
