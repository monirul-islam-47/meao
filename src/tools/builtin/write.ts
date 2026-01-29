import { z } from 'zod'
import { writeFile, mkdir, realpath } from 'fs/promises'
import path from 'path'
import type { ToolPlugin, ToolOutput, ToolContext } from '../types.js'

/**
 * Securely resolve a path within a working directory for writing.
 * Blocks:
 * - Absolute paths outside workDir
 * - Path traversal (../)
 * - Symlink escapes (checks parent directory for symlinks)
 */
async function resolveSecureWritePath(
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

  // For write operations, check if the parent directory (if it exists) has symlinks
  // that would escape the workDir
  const parentDir = path.dirname(resolvedPath)
  try {
    const realParentPath = await realpath(parentDir)
    if (!realParentPath.startsWith(normalizedWorkDir + path.sep) && realParentPath !== normalizedWorkDir) {
      return {
        safe: false,
        resolvedPath,
        error: 'Access denied: parent directory symlink points outside working directory',
      }
    }
  } catch {
    // Parent doesn't exist yet, which is fine for write with createDirectories
    // The resolved path is already validated to be within workDir
  }

  return { safe: true, resolvedPath }
}

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
      // Securely resolve path within working directory
      const { safe, resolvedPath, error } = await resolveSecureWritePath(
        filePath,
        context.workDir
      )

      if (!safe) {
        return {
          success: false,
          output: error || 'Access denied',
        }
      }

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
