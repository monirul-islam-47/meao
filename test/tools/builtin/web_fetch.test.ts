import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { webFetchTool } from '../../../src/tools/builtin/web_fetch.js'
import type { ToolContext } from '../../../src/tools/types.js'
import { ProcessSandbox } from '../../../src/sandbox/process.js'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock networkGuard
vi.mock('../../../src/security/network/index.js', () => ({
  networkGuard: {
    checkUrl: vi.fn().mockResolvedValue({ allowed: true }),
  },
}))

import { networkGuard } from '../../../src/security/network/index.js'
const mockCheckUrl = vi.mocked(networkGuard.checkUrl)

const createMockContext = (): ToolContext => ({
  sessionId: 'test-session',
  turnId: 'test-turn',
  sandbox: new ProcessSandbox({
    level: 'process',
    networkMode: 'none',
  }),
  workDir: '/tmp',
})

describe('webFetchTool', () => {
  let context: ToolContext

  beforeEach(() => {
    context = createMockContext()
    mockFetch.mockReset()
    mockCheckUrl.mockReset()
    mockCheckUrl.mockResolvedValue({ allowed: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has correct name and description', () => {
    expect(webFetchTool.name).toBe('web_fetch')
    expect(webFetchTool.description).toMatch(/fetch|url/i)
  })

  it('has auto approval level', () => {
    expect(webFetchTool.capability.approval.level).toBe('auto')
  })

  it('fetches plain text content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/plain']]),
      text: vi.fn().mockResolvedValue('Plain text response'),
    })

    const result = await webFetchTool.execute(
      { url: 'https://example.com/text' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe('Plain text response')
  })

  it('fetches JSON content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'application/json']]),
      text: vi.fn().mockResolvedValue('{"key": "value"}'),
    })

    const result = await webFetchTool.execute(
      { url: 'https://example.com/api' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe('{"key": "value"}')
  })

  it('extracts text from HTML', async () => {
    const html = `
      <html>
        <head><title>Test</title></head>
        <body>
          <script>console.log('removed')</script>
          <style>.removed { display: none; }</style>
          <main>
            <p>Main content here</p>
            <a href="https://example.com">Link text</a>
          </main>
        </body>
      </html>
    `
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/html']]),
      text: vi.fn().mockResolvedValue(html),
    })

    const result = await webFetchTool.execute(
      { url: 'https://example.com/page' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('Main content here')
    expect(result.output).toContain('[Link text](https://example.com)')
    expect(result.output).not.toContain('console.log')
    expect(result.output).not.toContain('.removed')
  })

  it('handles HTTP errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Map([['content-type', 'text/plain']]),
      text: vi.fn().mockResolvedValue('Page not found'),
    })

    const result = await webFetchTool.execute(
      { url: 'https://example.com/missing' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.output).toContain('404')
    expect(result.output).toContain('Not Found')
  })

  it('handles network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await webFetchTool.execute(
      { url: 'https://example.com/fail' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.output).toMatch(/network error/i)
  })

  it('handles timeout', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    mockFetch.mockRejectedValue(abortError)

    const result = await webFetchTool.execute(
      { url: 'https://example.com/slow', timeout: 1000 },
      context
    )

    expect(result.success).toBe(false)
    expect(result.output).toMatch(/timed out/i)
  })

  it('sends correct HTTP method', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/plain']]),
      text: vi.fn().mockResolvedValue('OK'),
    })

    await webFetchTool.execute(
      { url: 'https://example.com/api', method: 'POST', body: '{"data":1}' },
      context
    )

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'POST',
        body: '{"data":1}',
      })
    )
  })

  it('sends custom headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/plain']]),
      text: vi.fn().mockResolvedValue('OK'),
    })

    await webFetchTool.execute(
      {
        url: 'https://example.com/api',
        headers: { Authorization: 'Bearer token' },
      },
      context
    )

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
      })
    )
  })

  it('has allowlist of known hosts', () => {
    const allowedHosts = webFetchTool.capability.network?.allowedHosts ?? []
    expect(allowedHosts).toContain('*.github.com')
    expect(allowedHosts).toContain('*.stackoverflow.com')
  })

  it('blocks private IPs', () => {
    expect(webFetchTool.capability.network?.blockPrivateIPs).toBe(true)
  })

  it('blocks metadata endpoints', () => {
    expect(webFetchTool.capability.network?.blockMetadataEndpoints).toBe(true)
  })

  it('has GET and POST actions', () => {
    const getAction = webFetchTool.actions.find((a) => a.action === 'GET')
    const postAction = webFetchTool.actions.find((a) => a.action === 'POST')

    expect(getAction).toBeDefined()
    expect(getAction?.affectsOthers).toBe(false)

    expect(postAction).toBeDefined()
    expect(postAction?.affectsOthers).toBe(true)
  })

  describe('redirect handling', () => {
    it('follows redirects with re-validation', async () => {
      // First request returns redirect
      mockFetch
        .mockResolvedValueOnce({
          status: 302,
          headers: new Map([['location', 'https://example.com/final']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'text/plain']]),
          text: vi.fn().mockResolvedValue('Final content'),
        })

      const result = await webFetchTool.execute(
        { url: 'https://example.com/redirect' },
        context
      )

      expect(result.success).toBe(true)
      expect(result.output).toBe('Final content')
      // Verify redirect was validated
      expect(mockCheckUrl).toHaveBeenCalledWith('https://example.com/final', 'GET')
    })

    it('blocks redirects to disallowed hosts', async () => {
      // First request returns redirect to disallowed host
      mockFetch.mockResolvedValueOnce({
        status: 302,
        headers: new Map([['location', 'https://evil.com/malware']]),
      })

      // Network guard blocks the redirect
      mockCheckUrl.mockResolvedValueOnce({
        allowed: false,
        reason: 'Host not in allowlist: evil.com',
      })

      const result = await webFetchTool.execute(
        { url: 'https://example.com/redirect' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.output).toContain('blocked')
      expect(result.output).toContain('evil.com')
    })

    it('handles relative redirect URLs', async () => {
      mockFetch
        .mockResolvedValueOnce({
          status: 302,
          headers: new Map([['location', '/new-path']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'text/plain']]),
          text: vi.fn().mockResolvedValue('Content'),
        })

      const result = await webFetchTool.execute(
        { url: 'https://example.com/old-path' },
        context
      )

      expect(result.success).toBe(true)
      // Should have validated the resolved absolute URL
      expect(mockCheckUrl).toHaveBeenCalledWith('https://example.com/new-path', 'GET')
    })

    it('limits number of redirects', async () => {
      // Return redirect for every request (infinite loop)
      mockFetch.mockResolvedValue({
        status: 302,
        headers: new Map([['location', 'https://example.com/loop']]),
      })

      const result = await webFetchTool.execute(
        { url: 'https://example.com/start' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.output).toContain('Too many redirects')
    })

    it('handles redirect without Location header', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 302,
        headers: new Map(),
      })

      const result = await webFetchTool.execute(
        { url: 'https://example.com/bad-redirect' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.output).toContain('missing Location')
    })

    it('uses manual redirect mode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: vi.fn().mockResolvedValue('OK'),
      })

      await webFetchTool.execute(
        { url: 'https://example.com/page' },
        context
      )

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/page',
        expect.objectContaining({
          redirect: 'manual',
        })
      )
    })
  })
})
