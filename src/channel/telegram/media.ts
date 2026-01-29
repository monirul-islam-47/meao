/**
 * Media/attachment handling for Telegram channel.
 *
 * Downloads files from Telegram servers and stores them locally
 * to avoid exposing token-bearing URLs to tools.
 */

import { createWriteStream } from 'fs'
import { mkdir, unlink } from 'fs/promises'
import { join, basename, extname } from 'path'
import { randomUUID } from 'crypto'
import type { Context } from 'telegraf'
import type { Message } from 'telegraf/types'

/** Maximum file size in bytes (50MB) */
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * Sanitize a filename to prevent path traversal and other issues.
 *
 * - Removes path separators and special characters
 * - Limits length to 255 characters
 * - Ensures a valid extension
 */
export function sanitizeFilename(filename: string, fallbackExt: string = ''): string {
  // Normalize path separators (handle both Unix and Windows style)
  let sanitized = filename.replace(/\\/g, '/')

  // Get basename to strip any path components
  sanitized = basename(sanitized)

  // Remove or replace potentially dangerous characters
  // Allow only alphanumeric, dash, underscore, dot
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_')

  // Remove any leading dots (hidden files) or multiple consecutive dots
  sanitized = sanitized.replace(/^\.+/, '').replace(/\.{2,}/g, '.')

  // Remove leading/trailing underscores that resulted from sanitization
  sanitized = sanitized.replace(/^_+|_+$/g, '')

  // If nothing left, generate a random name (check before adding extension)
  if (!sanitized || sanitized === '.') {
    sanitized = `file_${randomUUID()}`
  }

  // Ensure we have a valid extension
  const ext = extname(sanitized)
  if (!ext && fallbackExt) {
    sanitized = `${sanitized}.${fallbackExt.replace(/^\./, '')}`
  }

  // Limit total length to 255 characters (filesystem limit)
  if (sanitized.length > 255) {
    const currentExt = extname(sanitized)
    const nameWithoutExt = sanitized.slice(0, sanitized.length - currentExt.length)
    sanitized = nameWithoutExt.slice(0, 255 - currentExt.length) + currentExt
  }

  return sanitized
}

/**
 * Attachment extracted from a Telegram message.
 */
export interface Attachment {
  type: 'image' | 'document' | 'audio' | 'video'
  name: string
  localPath: string
  mimeType?: string
  size?: number
}

/**
 * Extract and download attachments from a Telegram message.
 *
 * Files are downloaded to a local directory to avoid exposing
 * Telegram's token-bearing file URLs to tools.
 *
 * @param ctx - Telegraf context
 * @param message - Telegram message
 * @param botToken - Bot token for file download
 * @param attachmentDir - Directory to store downloaded files
 * @returns Array of extracted attachments with local paths
 */
export async function extractAttachments(
  ctx: Context,
  message: Message,
  botToken: string,
  attachmentDir: string
): Promise<Attachment[]> {
  const attachments: Attachment[] = []

  // Ensure attachment directory exists
  await mkdir(attachmentDir, { recursive: true })

  // Handle photos (array of sizes, get largest)
  if ('photo' in message && message.photo && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1] // Highest resolution
    const file = await ctx.telegram.getFile(photo.file_id)

    if (file.file_path) {
      const fileName = sanitizeFilename(`photo_${randomUUID()}.jpg`, 'jpg')
      const localPath = await downloadFile(botToken, file.file_path, attachmentDir, fileName)

      attachments.push({
        type: 'image',
        name: fileName,
        localPath,
        size: photo.file_size,
      })
    }
  }

  // Handle documents
  if ('document' in message && message.document) {
    const doc = message.document
    const file = await ctx.telegram.getFile(doc.file_id)

    if (file.file_path) {
      const rawName = doc.file_name ?? `document_${randomUUID()}`
      const fileName = sanitizeFilename(rawName)
      const localPath = await downloadFile(botToken, file.file_path, attachmentDir, fileName)

      attachments.push({
        type: 'document',
        name: fileName,
        localPath,
        mimeType: doc.mime_type,
        size: doc.file_size,
      })
    }
  }

  // Handle audio
  if ('audio' in message && message.audio) {
    const audio = message.audio
    const file = await ctx.telegram.getFile(audio.file_id)

    if (file.file_path) {
      const ext = audio.mime_type?.split('/')[1] ?? 'mp3'
      const rawName = audio.file_name ?? `audio_${randomUUID()}.${ext}`
      const fileName = sanitizeFilename(rawName, ext)
      const localPath = await downloadFile(botToken, file.file_path, attachmentDir, fileName)

      attachments.push({
        type: 'audio',
        name: fileName,
        localPath,
        mimeType: audio.mime_type,
        size: audio.file_size,
      })
    }
  }

  // Handle video
  if ('video' in message && message.video) {
    const video = message.video
    const file = await ctx.telegram.getFile(video.file_id)

    if (file.file_path) {
      const ext = video.mime_type?.split('/')[1] ?? 'mp4'
      const rawName = video.file_name ?? `video_${randomUUID()}.${ext}`
      const fileName = sanitizeFilename(rawName, ext)
      const localPath = await downloadFile(botToken, file.file_path, attachmentDir, fileName)

      attachments.push({
        type: 'video',
        name: fileName,
        localPath,
        mimeType: video.mime_type,
        size: video.file_size,
      })
    }
  }

  // Handle voice messages
  if ('voice' in message && message.voice) {
    const voice = message.voice
    const file = await ctx.telegram.getFile(voice.file_id)

    if (file.file_path) {
      const fileName = sanitizeFilename(`voice_${randomUUID()}.ogg`, 'ogg')
      const localPath = await downloadFile(botToken, file.file_path, attachmentDir, fileName)

      attachments.push({
        type: 'audio',
        name: fileName,
        localPath,
        mimeType: voice.mime_type ?? 'audio/ogg',
        size: voice.file_size,
      })
    }
  }

  return attachments
}

/**
 * Download a file from Telegram's servers.
 *
 * Streams the file to disk to handle large files efficiently,
 * and enforces a maximum file size limit.
 *
 * @param botToken - Bot token
 * @param filePath - Telegram file path
 * @param attachmentDir - Local directory
 * @param fileName - Local file name (should already be sanitized)
 * @param maxSize - Maximum file size in bytes (default: MAX_FILE_SIZE)
 * @returns Local file path
 * @throws Error if file exceeds size limit or download fails
 */
async function downloadFile(
  botToken: string,
  filePath: string,
  attachmentDir: string,
  fileName: string,
  maxSize: number = MAX_FILE_SIZE
): Promise<string> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`)
  }

  // Check Content-Length header if available
  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new Error(`File too large: ${contentLength} bytes exceeds ${maxSize} byte limit`)
  }

  const localPath = join(attachmentDir, fileName)

  // Stream to disk with size enforcement
  const body = response.body
  if (!body) {
    throw new Error('Response body is empty')
  }

  const fileStream = createWriteStream(localPath)
  const reader = body.getReader()

  let bytesWritten = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      bytesWritten += value.length

      if (bytesWritten > maxSize) {
        // Clean up and throw
        fileStream.close()
        await unlink(localPath).catch(() => {}) // Ignore cleanup errors
        throw new Error(`File too large: exceeded ${maxSize} byte limit during download`)
      }

      fileStream.write(value)
    }
  } finally {
    fileStream.end()
  }

  // Wait for stream to finish
  await new Promise<void>((resolve, reject) => {
    fileStream.on('finish', resolve)
    fileStream.on('error', reject)
  })

  return localPath
}
