import type { ToolPlugin } from './types.js'

/**
 * Registry for managing tool plugins.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolPlugin>()

  /**
   * Register a tool.
   */
  register(tool: ToolPlugin): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  /**
   * Get a tool by name.
   */
  get(name: string): ToolPlugin | undefined {
    return this.tools.get(name)
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Get all registered tools.
   */
  all(): ToolPlugin[] {
    return Array.from(this.tools.values())
  }

  /**
   * Get all tool names.
   */
  names(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * Unregister a tool.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear()
  }

  /**
   * Get tool definitions for AI provider.
   */
  getToolDefinitions(): Array<{
    name: string
    description: string
    input_schema: unknown
  }> {
    return this.all().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters._def,
    }))
  }
}

// Default singleton instance
let defaultRegistry: ToolRegistry | null = null

/**
 * Get the default tool registry.
 */
export function getToolRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ToolRegistry()
  }
  return defaultRegistry
}

/**
 * Reset the default registry (for testing).
 */
export function resetToolRegistry(): void {
  defaultRegistry = null
}
