// Schema and types
export { AppConfigSchema, type AppConfig } from './schema.js'
export type {
  OwnerConfig,
  ServerConfig,
  ChannelConfig,
  ProviderConfig,
  MemoryConfig,
  SandboxConfig,
  LoggingConfig,
  ToolConfig,
  SkillConfig,
} from './schema.js'

// Defaults
export { getDefaults } from './defaults.js'

// Paths
export {
  getMeaoHome,
  getConfigPath,
  getLocalConfigPath,
  getCredentialsPath,
  getLogsPath,
  getAuditPath,
  getKeysPath,
} from './paths.js'

// Environment parsing
export { parseEnvConfig, parseValue, parseCLIConfig, type CLIArgs } from './env.js'

// File utilities
export { fileExists, loadConfigFile, saveConfigFile, ensureDir } from './file.js'

// Merge utilities
export { deepMerge, setPath, getPath } from './merge.js'

// Loader
export { loadConfig } from './loader.js'

// Manager
export { ConfigManager, getConfigManager } from './manager.js'

// Credentials
export {
  resolveCredential,
  credentialExists,
  CredentialStore,
  getCredentialStore,
  ConfigError,
} from './credentials.js'

// Validation
export {
  validateConfig,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
} from './validation.js'
