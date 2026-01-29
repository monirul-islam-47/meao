import { z } from 'zod'
import type { ToolPlugin, ToolOutput, ToolContext } from '../types.js'

/**
 * Bash tool - executes shell commands.
 */
export const bashTool: ToolPlugin = {
  name: 'bash',
  description: 'Execute shell commands',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    workDir: z.string().optional().describe('Working directory for the command'),
    timeout: z
      .number()
      .optional()
      .default(120000)
      .describe('Timeout in milliseconds'),
  }),
  capability: {
    name: 'bash',
    approval: {
      level: 'ask', // Always ask before executing shell commands
      dangerPatterns: [
        /rm\s+-rf/,
        />\s*\/dev\/sd/,
        /mkfs/,
        /dd\s+if=/,
        /chmod\s+777/,
        /curl.*\|\s*sh/,
        /wget.*\|\s*sh/,
      ],
    },
    execution: {
      sandbox: 'container', // Always containerized
      networkDefault: 'none', // No network by default
    },
    labels: {
      outputTrust: 'user',
      outputDataClass: 'internal',
      acceptsUntrusted: true,
    },
    audit: {
      logArgs: true, // Log command
      logOutput: false, // Don't log output
    },
  },
  actions: [
    {
      tool: 'bash',
      action: 'execute',
      affectsOthers: false,
      isDestructive: true,
      hasFinancialImpact: false,
    },
  ],
  async execute(args: unknown, context: ToolContext): Promise<ToolOutput> {
    const { command, workDir, timeout } = args as {
      command: string
      workDir?: string
      timeout: number
    }

    try {
      // Execute via sandbox (container if available, process otherwise)
      // Pass workDir and timeout overrides if specified
      const result = await context.sandbox.execute(command, 'bash', {
        workDir: workDir ?? context.workDir,
        timeout,
      })

      // Format output
      let output = ''
      if (result.stdout) {
        output += result.stdout
      }
      if (result.stderr) {
        if (output) output += '\n'
        output += `stderr: ${result.stderr}`
      }

      if (result.timedOut) {
        output += '\n[Command timed out]'
      }

      if (result.truncated) {
        output += '\n[Output truncated]'
      }

      return {
        success: result.exitCode === 0,
        output: output || '(no output)',
        exitCode: result.exitCode,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error executing command'
      return {
        success: false,
        output: `Error executing command: ${message}`,
      }
    }
  },
}
