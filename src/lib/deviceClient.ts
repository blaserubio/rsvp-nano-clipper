// Talks to the RSVP Nano device's companion-sync HTTP API. Contract is
// documented in the v1 README and mirrored in three reference implementations
// in the upstream rsvpnano repo (NanoClient.swift, the firmware's
// CompanionSyncManager handlers, and the browser uploader the firmware serves
// at http://192.168.4.1).
//
//   POST  <endpoint>/api/books?name=<urlencoded>&category=<book|article>
//   GET   <endpoint>/api/info        (used by Settings → Test connection)
//
// Errors are normalised into a tagged union so the popup can show the right
// message and decide whether to offer the "Download .rsvp instead" fallback.

import type { DeviceInfo, RsvpFileForUpload, UploadResult } from './types'

export const UPLOAD_TIMEOUT_MS = 15_000
export const INFO_TIMEOUT_MS = 8_000

/**
 * POST a converted .rsvp file to the device's /api/books endpoint.
 * Errors are categorised; never throws — the caller branches on result.kind.
 */
export async function uploadArticle(
  file: RsvpFileForUpload,
  endpoint: string,
): Promise<UploadResult> {
  const url =
    `${endpoint}/api/books` +
    `?name=${encodeURIComponent(file.filename)}` +
    `&category=article`

  const body = new FormData()
  body.append(
    'file',
    new Blob([file.content], { type: 'text/plain;charset=utf-8' }),
    file.filename,
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal,
      // Don't set Content-Type — fetch generates the multipart boundary.
    })
  } catch (error) {
    clearTimeout(timer)
    if (isAbortError(error)) {
      return { kind: 'timeout', timeoutMs: UPLOAD_TIMEOUT_MS }
    }
    return {
      kind: 'unreachable',
      detail: describe(error),
    }
  }
  clearTimeout(timer)

  if (response.ok) {
    // The device returns JSON describing the saved file. We don't strictly
    // need the body for v1.1, but parse leniently so future versions can
    // surface the saved path / device's own filename.
    let parsedFilename: string | undefined
    try {
      const text = await response.text()
      if (text.trim().length > 0) {
        const json = JSON.parse(text) as { name?: string; filename?: string }
        parsedFilename = json.name ?? json.filename
      }
    } catch {
      /* the device sometimes returns no body on success; ignore */
    }
    return {
      kind: 'ok',
      filename: parsedFilename ?? file.filename,
    }
  }

  // 4xx / 5xx
  const errorMessage = await readErrorMessage(response)
  if (response.status >= 400 && response.status < 500) {
    return {
      kind: 'rejected',
      status: response.status,
      message: errorMessage ?? `Reader rejected the upload (HTTP ${response.status}).`,
    }
  }
  return {
    kind: 'error',
    status: response.status,
    message: errorMessage ?? `Reader returned HTTP ${response.status}.`,
  }
}

/**
 * Hit GET /api/info to confirm the endpoint is reachable and to surface the
 * device's name + firmware version in the Settings "Test connection" flow.
 * Same error categorisation as uploadArticle.
 */
export async function fetchDeviceInfo(
  endpoint: string,
): Promise<
  | { kind: 'ok'; info: DeviceInfo }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'rejected'; status: number; message: string }
  | { kind: 'error'; status: number; message: string }
> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), INFO_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${endpoint}/api/info`, {
      method: 'GET',
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    if (isAbortError(error)) {
      return { kind: 'timeout', timeoutMs: INFO_TIMEOUT_MS }
    }
    return { kind: 'unreachable', detail: describe(error) }
  }
  clearTimeout(timer)

  if (!response.ok) {
    const message = await readErrorMessage(response)
    if (response.status >= 400 && response.status < 500) {
      return {
        kind: 'rejected',
        status: response.status,
        message: message ?? `Reader returned HTTP ${response.status}.`,
      }
    }
    return {
      kind: 'error',
      status: response.status,
      message: message ?? `Reader returned HTTP ${response.status}.`,
    }
  }

  try {
    const text = await response.text()
    const json = JSON.parse(text) as Record<string, unknown>
    return {
      kind: 'ok',
      info: {
        name: stringField(json, 'name') ?? 'RSVP Nano',
        version: stringField(json, 'version') ?? null,
        mode: stringField(json, 'mode') ?? null,
        networkSsid: stringField(json, 'networkSsid') ?? null,
        pairingCode: stringField(json, 'pairingCode') ?? null,
      },
    }
  } catch (error) {
    return {
      kind: 'error',
      status: response.status,
      message: `Could not parse reader response: ${describe(error)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (error instanceof Error && error.name === 'AbortError')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text()
    if (text.trim().length === 0) return undefined
    try {
      const json = JSON.parse(text) as { error?: unknown; message?: unknown }
      if (typeof json.error === 'string' && json.error.trim().length > 0) {
        return json.error
      }
      if (typeof json.message === 'string' && json.message.trim().length > 0) {
        return json.message
      }
    } catch {
      // Not JSON — return raw text if it's short enough to be a useful error.
      if (text.length <= 200) return text.trim()
    }
  } catch {
    /* response body already consumed or unreadable */
  }
  return undefined
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}
