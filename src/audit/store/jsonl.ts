import { mkdir, appendFile, readFile, readdir } from 'fs/promises'
import path from 'path'
import type { AuditEntry } from '../schema.js'
import { AuditEntrySchema } from '../schema.js'
import { sanitizeAuditEntry } from '../redaction.js'
import type { AuditStore, AuditFilter } from './interface.js'

/**
 * JSONL-based audit store with daily file rotation.
 *
 * File naming: audit-YYYY-MM-DD.jsonl
 * Location: MEAO_HOME/logs/audit/
 */
export class JsonlAuditStore implements AuditStore {
  private readonly baseDir: string
  private initialized = false

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  /**
   * Ensure the audit directory exists.
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.baseDir, { recursive: true })
    this.initialized = true
  }

  /**
   * Get the filename for a given date.
   */
  private getFilename(date: Date): string {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `audit-${yyyy}-${mm}-${dd}.jsonl`
  }

  /**
   * Get the full path for a given date's audit file.
   */
  private getFilePath(date: Date): string {
    return path.join(this.baseDir, this.getFilename(date))
  }

  /**
   * Append an audit entry to the store.
   * The entry is sanitized before writing.
   */
  async append(entry: AuditEntry): Promise<void> {
    await this.ensureDir()

    // CRITICAL: Sanitize before writing - this is the choke point
    const sanitized = sanitizeAuditEntry(entry)

    const filePath = this.getFilePath(sanitized.timestamp)
    const line = JSON.stringify(sanitized) + '\n'

    await appendFile(filePath, line, 'utf-8')
  }

  /**
   * Query audit entries matching the filter.
   */
  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    await this.ensureDir()

    const results: AuditEntry[] = []
    const files = await this.getRelevantFiles(filter)

    for (const file of files) {
      const entries = await this.readFile(file)
      for (const entry of entries) {
        if (this.matchesFilter(entry, filter)) {
          results.push(entry)
          if (filter.limit && results.length >= filter.limit) {
            return results
          }
        }
      }
    }

    return results
  }

  /**
   * Get files that may contain entries matching the filter.
   */
  private async getRelevantFiles(filter: AuditFilter): Promise<string[]> {
    let files: string[]
    try {
      files = await readdir(this.baseDir)
    } catch {
      return []
    }

    // Filter to only .jsonl files and sort by date descending (newest first)
    const jsonlFiles = files
      .filter((f) => f.startsWith('audit-') && f.endsWith('.jsonl'))
      .sort()
      .reverse()

    // If date filters provided, narrow down files
    if (filter.since || filter.until) {
      return jsonlFiles.filter((f) => {
        const dateStr = f.replace('audit-', '').replace('.jsonl', '')
        const fileDate = new Date(dateStr + 'T00:00:00')

        if (filter.since && fileDate < this.startOfDay(filter.since)) {
          // File is before the since date - might still have entries
          // if since is in the middle of that day
          const nextDay = new Date(fileDate)
          nextDay.setDate(nextDay.getDate() + 1)
          if (nextDay <= filter.since) return false
        }

        if (filter.until && fileDate > filter.until) {
          return false
        }

        return true
      })
    }

    return jsonlFiles
  }

  /**
   * Get start of day for a date.
   */
  private startOfDay(date: Date): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
  }

  /**
   * Read and parse entries from a file.
   */
  private async readFile(filename: string): Promise<AuditEntry[]> {
    const filePath = path.join(this.baseDir, filename)
    let content: string

    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      return []
    }

    const entries: AuditEntry[] = []
    const lines = content.split('\n').filter((line) => line.trim())

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        const entry = AuditEntrySchema.parse(parsed)
        entries.push(entry)
      } catch {
        // Skip malformed lines
        continue
      }
    }

    return entries
  }

  /**
   * Check if an entry matches the filter.
   */
  private matchesFilter(entry: AuditEntry, filter: AuditFilter): boolean {
    if (filter.since && entry.timestamp < filter.since) {
      return false
    }

    if (filter.until && entry.timestamp > filter.until) {
      return false
    }

    if (filter.category && entry.category !== filter.category) {
      return false
    }

    if (filter.action && entry.action !== filter.action) {
      return false
    }

    if (filter.severity && entry.severity !== filter.severity) {
      return false
    }

    return true
  }
}
