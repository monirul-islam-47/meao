/**
 * Telegram Markdown formatting utilities.
 *
 * Telegram uses MarkdownV2 which requires escaping special characters.
 * These utilities handle proper escaping and message chunking.
 */

/**
 * Characters that must be escaped in Telegram MarkdownV2.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
const SPECIAL_CHARS = [
  '_',
  '*',
  '[',
  ']',
  '(',
  ')',
  '~',
  '`',
  '>',
  '#',
  '+',
  '-',
  '=',
  '|',
  '{',
  '}',
  '.',
  '!',
]

/**
 * Escape special characters for Telegram MarkdownV2.
 *
 * @param text - Raw text to escape
 * @returns Escaped text safe for MarkdownV2
 */
export function escapeMarkdown(text: string): string {
  let escaped = text
  for (const char of SPECIAL_CHARS) {
    escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`)
  }
  return escaped
}

/**
 * Format a code block for Telegram.
 *
 * @param code - Code content
 * @param language - Optional language for syntax highlighting
 * @returns Formatted code block
 */
export function formatCode(code: string, language?: string): string {
  if (language) {
    return `\`\`\`${language}\n${code}\n\`\`\``
  }
  return `\`\`\`\n${code}\n\`\`\``
}

/**
 * Format inline code for Telegram.
 *
 * @param code - Code content
 * @returns Formatted inline code
 */
export function formatInlineCode(code: string): string {
  return `\`${code}\``
}

/**
 * Format bold text for Telegram.
 *
 * @param text - Text to make bold
 * @returns Formatted bold text
 */
export function formatBold(text: string): string {
  return `*${text}*`
}

/**
 * Format italic text for Telegram.
 *
 * @param text - Text to make italic
 * @returns Formatted italic text
 */
export function formatItalic(text: string): string {
  return `_${text}_`
}

/**
 * Format a hyperlink for Telegram.
 *
 * @param text - Link text
 * @param url - Link URL
 * @returns Formatted hyperlink
 */
export function formatLink(text: string, url: string): string {
  return `[${text}](${url})`
}

/**
 * Split a long message into chunks that fit Telegram's limits.
 *
 * Telegram has a 4096 character limit per message.
 * This function splits at natural break points (newlines, spaces).
 *
 * @param text - Text to split
 * @param maxLength - Maximum length per chunk (default 4000 to leave margin)
 * @returns Array of message chunks
 */
export function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // Find a good break point
    let breakPoint = remaining.lastIndexOf('\n', maxLength)

    // If no newline found, try space
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(' ', maxLength)
    }

    // If still no good break, force break at maxLength
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = maxLength
    }

    chunks.push(remaining.slice(0, breakPoint))
    remaining = remaining.slice(breakPoint).trimStart()
  }

  return chunks
}
