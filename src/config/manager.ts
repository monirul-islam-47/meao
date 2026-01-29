import type { AppConfig } from './schema.js'
import { loadConfig } from './loader.js'
import { validateConfig, type ValidationResult } from './validation.js'
import type { CLIArgs } from './env.js'

/**
 * Configuration manager that holds the current config and provides
 * methods for reloading and validation.
 */
export class ConfigManager {
  private _config: AppConfig | null = null

  /**
   * Get the current configuration.
   * Throws if config has not been loaded.
   */
  get config(): AppConfig {
    if (!this._config) {
      throw new Error('Configuration not loaded. Call load() first.')
    }
    return this._config
  }

  /**
   * Check if configuration has been loaded.
   */
  get isLoaded(): boolean {
    return this._config !== null
  }

  /**
   * Load configuration from all sources.
   */
  async load(cliArgs: CLIArgs = {}): Promise<AppConfig> {
    this._config = await loadConfig(cliArgs)
    return this._config
  }

  /**
   * Reload configuration from all sources.
   */
  async reload(cliArgs: CLIArgs = {}): Promise<AppConfig> {
    return this.load(cliArgs)
  }

  /**
   * Validate the current configuration.
   */
  async validate(): Promise<ValidationResult> {
    return validateConfig(this.config)
  }

  /**
   * Get a specific configuration value by path.
   */
  get<T>(path: string): T | undefined {
    const parts = path.split('.')
    let current: unknown = this.config

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      if (typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current as T
  }
}

// Singleton instance
let configManagerInstance: ConfigManager | null = null

/**
 * Get the singleton config manager instance.
 */
export function getConfigManager(): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager()
  }
  return configManagerInstance
}
