import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ENDPOINT,
  endpointOriginPattern,
  isDefaultEndpoint,
  normalizeEndpoint,
} from '../src/lib/settings'

describe('normalizeEndpoint', () => {
  it('returns the default endpoint as-is', () => {
    expect(normalizeEndpoint(DEFAULT_ENDPOINT)).toBe(DEFAULT_ENDPOINT)
  })

  it('adds http:// when no scheme is present', () => {
    expect(normalizeEndpoint('192.168.4.1')).toBe('http://192.168.4.1')
  })

  it('strips a trailing slash', () => {
    expect(normalizeEndpoint('http://192.168.4.1/')).toBe('http://192.168.4.1')
  })

  it('lowercases the scheme and host', () => {
    expect(normalizeEndpoint('HTTP://Reader.Local:8080/')).toBe(
      'http://reader.local:8080',
    )
  })

  it('keeps non-default ports', () => {
    expect(normalizeEndpoint('http://192.168.4.1:8080')).toBe(
      'http://192.168.4.1:8080',
    )
  })

  it('strips embedded user info, query, and fragment', () => {
    expect(normalizeEndpoint('http://user:pw@192.168.4.1/?a=1#frag')).toBe(
      'http://192.168.4.1',
    )
  })

  it('accepts https', () => {
    expect(normalizeEndpoint('https://reader.example.com')).toBe(
      'https://reader.example.com',
    )
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeEndpoint('   http://192.168.4.1   ')).toBe(
      'http://192.168.4.1',
    )
  })

  it('rejects empty input', () => {
    expect(() => normalizeEndpoint('')).toThrow(/empty/i)
    expect(() => normalizeEndpoint('   ')).toThrow(/empty/i)
  })

  it('rejects non-http schemes', () => {
    expect(() => normalizeEndpoint('ftp://192.168.4.1')).toThrow(/http/i)
    expect(() => normalizeEndpoint('file:///etc/hosts')).toThrow(/http/i)
  })

  it('rejects URLs without a host', () => {
    expect(() => normalizeEndpoint('http://')).toThrow()
  })

  it('rejects garbage', () => {
    expect(() => normalizeEndpoint('not a url at all')).toThrow()
  })
})

describe('isDefaultEndpoint', () => {
  it('recognises the default endpoint', () => {
    expect(isDefaultEndpoint(DEFAULT_ENDPOINT)).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isDefaultEndpoint('http://192.168.5.99')).toBe(false)
    expect(isDefaultEndpoint('http://192.168.4.1:8080')).toBe(false)
    expect(isDefaultEndpoint('http://192.168.4.1/')).toBe(false) // not normalised
  })
})

describe('endpointOriginPattern', () => {
  it('appends /* for chrome.permissions match patterns', () => {
    expect(endpointOriginPattern('http://192.168.4.1')).toBe(
      'http://192.168.4.1/*',
    )
    expect(endpointOriginPattern('http://reader.local:8080')).toBe(
      'http://reader.local:8080/*',
    )
  })
})
