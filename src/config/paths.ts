import path from 'path'
import os from 'os'

/**
 * Get the MEAO home directory.
 * Resolution order:
 * 1. MEAO_HOME environment variable
 * 2. XDG_CONFIG_HOME/meao (Linux)
 * 3. Platform-specific defaults
 */
export function getMeaoHome(): string {
  // 1. Explicit environment variable
  if (process.env.MEAO_HOME) {
    return process.env.MEAO_HOME
  }

  // 2. XDG_CONFIG_HOME (Linux)
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'meao')
  }

  // 3. Platform defaults
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || '', 'meao')
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'meao'
      )
    default:
      return path.join(os.homedir(), '.meao')
  }
}

/**
 * Get the path to the main config file.
 */
export function getConfigPath(): string {
  return path.join(getMeaoHome(), 'config.json')
}

/**
 * Get the path to the local config overrides file.
 */
export function getLocalConfigPath(): string {
  return path.join(getMeaoHome(), 'config.local.json')
}

/**
 * Get the path to the credentials file.
 */
export function getCredentialsPath(): string {
  return path.join(getMeaoHome(), 'credentials.json')
}

/**
 * Get the path to the logs directory.
 */
export function getLogsPath(): string {
  return path.join(getMeaoHome(), 'logs')
}

/**
 * Get the path to the audit logs directory.
 */
export function getAuditPath(): string {
  return path.join(getLogsPath(), 'audit')
}

/**
 * Get the path to the keys directory.
 */
export function getKeysPath(): string {
  return path.join(getMeaoHome(), 'keys')
}
