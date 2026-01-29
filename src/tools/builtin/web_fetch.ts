import { z } from 'zod'
import type { ToolPlugin, ToolOutput, ToolContext } from '../types.js'
import { networkGuard } from '../../security/network/index.js'

/**
 * Maximum number of redirects to follow.
 */
const MAX_REDIRECTS = 10

/**
 * Web fetch tool - fetches content from URLs.
 */
export const webFetchTool: ToolPlugin = {
  name: 'web_fetch',
  description: 'Fetch content from a URL',
  parameters: z.object({
    url: z.string().url().describe('The URL to fetch'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'DELETE'])
      .optional()
      .default('GET')
      .describe('HTTP method'),
    headers: z
      .record(z.string())
      .optional()
      .describe('Additional HTTP headers'),
    body: z.string().optional().describe('Request body for POST/PUT'),
    timeout: z
      .number()
      .optional()
      .default(30000)
      .describe('Timeout in milliseconds'),
  }),
  capability: {
    name: 'web_fetch',
    approval: {
      level: 'auto', // Auto-approve GET to known hosts
      conditions: {
        methodRequiresApproval: ['POST', 'PUT', 'DELETE'],
        unknownHostRequiresApproval: true,
      },
    },
    execution: {
      sandbox: 'process',
      networkDefault: 'proxy',
    },
    network: {
      mode: 'allowlist',
      allowedHosts: [
        '*.github.com',
        '*.githubusercontent.com',
        'raw.githubusercontent.com',
        '*.npmjs.com',
        '*.npmjs.org',
        '*.stackoverflow.com',
        '*.wikipedia.org',
        '*.mozilla.org',
      ],
      blockedPorts: [22, 23, 25, 3389],
      blockPrivateIPs: true,
      blockMetadataEndpoints: true,
    },
    labels: {
      outputTrust: 'untrusted', // External content is untrusted
      outputDataClass: 'internal',
      acceptsUntrusted: false,
    },
    audit: {
      logArgs: true, // Log URL
      logOutput: false, // NEVER log page content
    },
  },
  actions: [
    {
      tool: 'web_fetch',
      action: 'GET',
      affectsOthers: false,
      isDestructive: false,
      hasFinancialImpact: false,
    },
    {
      tool: 'web_fetch',
      action: 'POST',
      affectsOthers: true,
      isDestructive: false,
      hasFinancialImpact: false,
    },
  ],
  async execute(args: unknown, context: ToolContext): Promise<ToolOutput> {
    const { url, method, headers, body, timeout } = args as {
      url: string
      method: string
      headers?: Record<string, string>
      body?: string
      timeout: number
    }

    try {
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      // Follow redirects manually with re-validation
      let currentUrl = url
      let redirectCount = 0

      while (redirectCount <= MAX_REDIRECTS) {
        const response = await fetch(currentUrl, {
          method: redirectCount === 0 ? method : 'GET', // Use GET for redirect follows
          headers: {
            'User-Agent': 'meao/1.0',
            ...headers,
          },
          body: redirectCount === 0 && method !== 'GET' && body ? body : undefined,
          signal: controller.signal,
          redirect: 'manual', // Handle redirects manually to re-validate each hop
        })

        // Check for redirect (3xx status codes)
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) {
            clearTimeout(timeoutId)
            return {
              success: false,
              output: `Redirect response ${response.status} missing Location header`,
            }
          }

          // Resolve relative URLs
          const redirectUrl = new URL(location, currentUrl).href

          // Re-validate redirect target against network guard
          const checkResult = await networkGuard.checkUrl(redirectUrl, 'GET')
          if (!checkResult.allowed) {
            clearTimeout(timeoutId)
            return {
              success: false,
              output: `Redirect to ${redirectUrl} blocked: ${checkResult.reason}`,
            }
          }

          currentUrl = redirectUrl
          redirectCount++
          continue
        }

        clearTimeout(timeoutId)

        // Get response text
        const contentType = response.headers.get('content-type') ?? ''
        let content: string

        if (contentType.includes('application/json')) {
          // JSON passthrough
          content = await response.text()
        } else if (contentType.includes('text/html')) {
          // HTML - extract text content
          const html = await response.text()
          content = extractTextFromHtml(html)
        } else {
          // Plain text
          content = await response.text()
        }

        if (!response.ok) {
          return {
            success: false,
            output: `HTTP ${response.status}: ${response.statusText}\n${content}`,
          }
        }

        return {
          success: true,
          output: content,
        }
      }

      // Too many redirects
      return {
        success: false,
        output: `Too many redirects (max ${MAX_REDIRECTS})`,
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          output: `Request timed out after ${timeout}ms`,
        }
      }

      const message =
        error instanceof Error ? error.message : 'Unknown error fetching URL'
      return {
        success: false,
        output: `Error fetching URL: ${message}`,
      }
    }
  },
}

/**
 * Extract text content from HTML.
 */
function extractTextFromHtml(html: string): string {
  // Remove scripts and styles
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

  // Try to extract main content
  const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)

  if (mainMatch) {
    text = mainMatch[1]
  } else if (articleMatch) {
    text = articleMatch[1]
  } else {
    // Fall back to body
    const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    if (bodyMatch) {
      text = bodyMatch[1]
    }
  }

  // Convert links to markdown
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text
}
