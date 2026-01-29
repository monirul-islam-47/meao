import { promises as fs } from 'fs'
import path from 'path'

/**
 * Check if a file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Load a JSON config file.
 */
export async function loadConfigFile(
  filePath: string
): Promise<Record<string, unknown>> {
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * Save a JSON config file.
 */
export async function saveConfigFile(
  filePath: string,
  config: Record<string, unknown>
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Ensure a directory exists.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}
