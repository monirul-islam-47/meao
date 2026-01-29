import { AppConfigSchema, type AppConfig } from './schema.js'
import { getDefaults } from './defaults.js'
import { getConfigPath, getLocalConfigPath } from './paths.js'
import { parseEnvConfig, parseCLIConfig, type CLIArgs } from './env.js'
import { fileExists, loadConfigFile } from './file.js'
import { deepMerge } from './merge.js'

/**
 * Load configuration with full precedence chain.
 *
 * Precedence (later overrides earlier):
 * 1. Defaults
 * 2. User config file (config.json)
 * 3. Local overrides (config.local.json)
 * 4. Environment variables
 * 5. CLI arguments
 */
export async function loadConfig(cliArgs: CLIArgs = {}): Promise<AppConfig> {
  // 1. Start with defaults
  let config: Record<string, unknown> = getDefaults()

  // 2. Merge user config file
  const configPath = cliArgs.config ?? getConfigPath()
  if (await fileExists(configPath)) {
    const fileConfig = await loadConfigFile(configPath)
    config = deepMerge(config, fileConfig)
  }

  // 3. Merge local overrides (config.local.json)
  const localPath = cliArgs.config
    ? cliArgs.config.replace('.json', '.local.json')
    : getLocalConfigPath()
  if (await fileExists(localPath)) {
    const localConfig = await loadConfigFile(localPath)
    config = deepMerge(config, localConfig)
  }

  // 4. Merge environment variables
  const envConfig = parseEnvConfig()
  config = deepMerge(config, envConfig as Record<string, unknown>)

  // 5. Merge CLI arguments
  const cliConfig = parseCLIConfig(cliArgs)
  config = deepMerge(config, cliConfig as Record<string, unknown>)

  // 6. Validate with Zod
  return AppConfigSchema.parse(config)
}
