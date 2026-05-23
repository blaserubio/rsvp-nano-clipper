// Shared types between the popup, background, and content script.

export interface ExtractedArticle {
  title: string
  byline: string | null
  /** Sanitised HTML content from Readability. */
  contentHtml: string
  /** Plain text content (the body the user actually reads). */
  textContent: string
  /** Short excerpt / summary from Readability. */
  excerpt: string
  /** Character count of textContent. */
  length: number
  siteName: string | null
  lang: string | null
  url: string
  /** Readability's own heuristic: does this page look like an article? */
  readerable: boolean
  /**
   * Publication date of the article, normalised to ISO `YYYY-MM-DD`.
   * `null` when the page exposes no date in any of the sources we check
   * (Readability `publishedTime`, common meta tags, `<time datetime>`,
   * JSON-LD `datePublished`).
   */
  publishedDate: string | null
  /** Which extractor produced the final body. Useful for debugging. */
  method: 'readability' | 'fallback'
  /** Extraction diagnostics — word counts for the two paths. */
  diagnostics: {
    readabilityWords: number
    fallbackWords: number
    expandersClicked: number
    junkRemoved: number
  }
}

// --- Messages between extension surfaces -----------------------------------

export interface ExtractRequest {
  type: 'extract'
}

export type ExtractResponse =
  | { ok: true; article: ExtractedArticle }
  | { ok: false; error: string }

/** Ask the content script to visually highlight everything matching the
 *  given extracted text. The text is matched back to live DOM elements
 *  by first-N-char signature so we don't need to mutate the page during
 *  extraction. */
export interface HighlightRequest {
  type: 'highlight'
  textContent: string
}

export interface UnhighlightRequest {
  type: 'unhighlight'
}

export interface ScrollRequest {
  type: 'scroll'
  which: 'first' | 'last'
}

export type SimpleResponse =
  | { ok: true; count: number }
  | { ok: false; error: string }

export type ContentMessage =
  | ExtractRequest
  | HighlightRequest
  | UnhighlightRequest
  | ScrollRequest

// --- v1.1: settings + device transport -------------------------------------

/** User-configurable settings, persisted in chrome.storage.local. */
export interface Settings {
  /** Canonical, normalised endpoint URL (no trailing slash). */
  endpoint: string
}

/** Trimmed slice of GET /api/info used to confirm reachability and identity. */
export interface DeviceInfo {
  name: string
  version: string | null
  mode: string | null
  networkSsid: string | null
  pairingCode: string | null
}

/** What uploadArticle needs to do its work — a converted .rsvp ready to POST. */
export interface RsvpFileForUpload {
  filename: string
  content: string
}

/**
 * Result of an uploadArticle call. Always returned (never thrown) so the
 * caller can branch on `kind` to decide UI behaviour:
 *   - 'ok'          : success; show confirmation
 *   - 'timeout'     : we aborted the request; reader probably hung mid-upload
 *   - 'unreachable' : network failed before reaching the reader
 *   - 'rejected'    : reader responded 4xx (e.g. invalid filename, file exists)
 *   - 'error'       : reader responded 5xx or returned unparsable content
 */
export type UploadResult =
  | { kind: 'ok'; filename: string }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'rejected'; status: number; message: string }
  | { kind: 'error'; status: number; message: string }
