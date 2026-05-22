import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  UPLOAD_TIMEOUT_MS,
  fetchDeviceInfo,
  uploadArticle,
} from '../src/lib/deviceClient'
import type { RsvpFileForUpload } from '../src/lib/types'

const ENDPOINT = 'http://192.168.4.1'

const FILE: RsvpFileForUpload = {
  filename: '2026-05-22_test article.rsvp',
  content: '@rsvp 1\n@title Test\n@chapter Test\nHello world.\n',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// uploadArticle
// ---------------------------------------------------------------------------

describe('uploadArticle — happy path', () => {
  it('POSTs to /api/books with name + category=article query params', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { name: FILE.filename }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadArticle(FILE, ENDPOINT)
    expect(result.kind).toBe('ok')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `${ENDPOINT}/api/books?name=${encodeURIComponent(FILE.filename)}&category=article`,
    )
    expect(init.method).toBe('POST')
  })

  it('sends a multipart FormData body with a single "file" field carrying the converted bytes', async () => {
    let captured: FormData | null = null
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init.body as FormData
      return jsonResponse(200, {})
    })
    vi.stubGlobal('fetch', fetchMock)

    await uploadArticle(FILE, ENDPOINT)

    expect(captured).toBeInstanceOf(FormData)
    const fd = captured as unknown as FormData
    const entries = Array.from(fd.entries())
    expect(entries.length).toBe(1)
    expect(entries[0][0]).toBe('file')

    const value = entries[0][1]
    expect(value).toBeInstanceOf(Blob)
    const blob = value as Blob
    expect(blob.type).toBe('text/plain;charset=utf-8')

    // Verify the bytes themselves rather than the File.name, which real
    // browsers populate from the 3rd append() argument but happy-dom's
    // FormData implementation does not. The runtime contract still holds
    // (the filename is also in the URL query, which the firmware uses).
    const text = await blob.text()
    expect(text).toBe(FILE.content)
  })

  it('does not set Content-Type (fetch handles the multipart boundary)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    await uploadArticle(FILE, ENDPOINT)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string> | undefined
    if (headers) {
      const keys = Object.keys(headers).map((k) => k.toLowerCase())
      expect(keys).not.toContain('content-type')
    }
  })

  it('returns the saved filename from the response when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { name: 'server-renamed.rsvp' })),
    )
    const result = await uploadArticle(FILE, ENDPOINT)
    expect(result).toEqual({ kind: 'ok', filename: 'server-renamed.rsvp' })
  })

  it('falls back to the local filename if response body is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    )
    const result = await uploadArticle(FILE, ENDPOINT)
    expect(result).toEqual({ kind: 'ok', filename: FILE.filename })
  })
})

describe('uploadArticle — failure categorisation', () => {
  it('returns kind=unreachable when fetch throws a network TypeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const result = await uploadArticle(FILE, ENDPOINT)
    expect(result.kind).toBe('unreachable')
  })

  it('returns kind=timeout when the request aborts after UPLOAD_TIMEOUT_MS', async () => {
    // fetch waits forever for the response — the AbortController fires first.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init.signal
            if (signal) {
              signal.addEventListener('abort', () => {
                const err = new DOMException('Aborted', 'AbortError')
                reject(err)
              })
            }
          }),
      ),
    )

    const promise = uploadArticle(FILE, ENDPOINT)
    // Advance just past the timeout so the AbortController fires.
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS + 50)
    const result = await promise

    expect(result).toEqual({ kind: 'timeout', timeoutMs: UPLOAD_TIMEOUT_MS })
  })

  it('returns kind=rejected with the device error for 4xx + JSON {error}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { error: 'file already exists' })),
    )
    const result = await uploadArticle(FILE, ENDPOINT)
    expect(result).toEqual({
      kind: 'rejected',
      status: 409,
      message: 'file already exists',
    })
  })

  it('returns kind=rejected with a generic message for 4xx with no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 400 })),
    )
    const result = await uploadArticle(FILE, ENDPOINT)
    expect(result.kind).toBe('rejected')
    if (result.kind === 'rejected') {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/HTTP 400/)
    }
  })

  it('returns kind=error with the status for 5xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    const result = await uploadArticle(FILE, ENDPOINT)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.status).toBe(500)
    }
  })
})

// ---------------------------------------------------------------------------
// fetchDeviceInfo
// ---------------------------------------------------------------------------

describe('fetchDeviceInfo', () => {
  it('hits GET /api/info and returns parsed device info', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        name: 'RSVP-Nano-ABC123',
        version: 'v0.0.5',
        mode: 'companion',
        networkSsid: 'RSVP-Nano-ABC123',
        pairingCode: '4815',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchDeviceInfo(ENDPOINT)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.info.name).toBe('RSVP-Nano-ABC123')
      expect(result.info.version).toBe('v0.0.5')
      expect(result.info.networkSsid).toBe('RSVP-Nano-ABC123')
    }

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ENDPOINT}/api/info`)
    expect(init.method).toBe('GET')
  })

  it('returns unreachable on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const result = await fetchDeviceInfo(ENDPOINT)
    expect(result.kind).toBe('unreachable')
  })

  it('returns error when the response is unparsable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    )
    const result = await fetchDeviceInfo(ENDPOINT)
    expect(result.kind).toBe('error')
  })
})
