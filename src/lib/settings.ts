// User-configurable settings, persisted in chrome.storage.local.
//
// V1.1 has exactly one setting: the URL of the RSVP Nano device's
// companion-sync HTTP API. Default is the device-AP IP that the firmware
// hosts when "Companion sync" is active on the reader.

import type { Settings } from './types'

export const DEFAULT_ENDPOINT = 'http://192.168.4.1'
const STORAGE_KEY = 'settings'

/** Load settings, filling in defaults for anything missing. */
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const raw = stored[STORAGE_KEY] as Partial<Settings> | undefined
  return {
    endpoint:
      typeof raw?.endpoint === 'string' && raw.endpoint.length > 0
        ? raw.endpoint
        : DEFAULT_ENDPOINT,
  }
}

/** Persist settings. Caller is responsible for having already normalised. */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings })
}

/**
 * Normalise a raw endpoint string the user typed into the settings field
 * into a canonical form we can confidently pass to fetch().
 *
 * Throws Error with a short user-friendly message if the input cannot be
 * understood as an HTTP(S) URL with a host.
 *
 * Rules:
 *  - Trim leading/trailing whitespace.
 *  - If no scheme, prepend "http://" (the device is HTTP-only).
 *  - Lowercase the scheme and host (per RFC 3986).
 *  - Reject anything that isn't http: or https:.
 *  - Reject empty / host-less input.
 *  - Strip any trailing slash on the path so concatenation is unambiguous.
 *  - Strip any user info, query, or fragment (the endpoint is a base).
 */
export function normalizeEndpoint(input: string): string {
  const trimmed = (input ?? '').trim()
  if (trimmed.length === 0) {
    throw new Error('Device URL is empty.')
  }

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('Device URL is not a valid URL.')
  }

  const scheme = url.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new Error('Device URL must start with http:// or https://.')
  }
  if (url.hostname.length === 0) {
    throw new Error('Device URL is missing a host.')
  }

  url.protocol = scheme
  url.hostname = url.hostname.toLowerCase()
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''

  // url.toString() preserves a trailing slash on the path; strip it so that
  // callers can do `${endpoint}/api/books?…` without worrying about doubles.
  let normalised = url.toString()
  if (normalised.endsWith('/')) {
    normalised = normalised.slice(0, -1)
  }
  return normalised
}

/** True if the given (already normalised) endpoint is the default. */
export function isDefaultEndpoint(endpoint: string): boolean {
  return endpoint === DEFAULT_ENDPOINT
}

/** The origin used for chrome.permissions.request for a given endpoint. */
export function endpointOriginPattern(endpoint: string): string {
  // chrome.permissions.request takes URL match patterns. For an origin we
  // need scheme://host:port/* — fortunately the normalised endpoint already
  // has scheme + host + optional port, so we just append /*.
  return `${endpoint}/*`
}
