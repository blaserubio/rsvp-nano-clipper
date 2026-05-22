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
