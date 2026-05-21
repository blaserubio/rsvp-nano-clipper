// Content script: runs on every page at document_idle. Stays passive until
// the popup (or background) asks it to extract the current article via
// Readability. The extracted text/HTML is sanitised with DOMPurify before
// being shipped back across the message boundary.

import { isProbablyReaderable, Readability } from '@mozilla/readability'
import DOMPurify from 'dompurify'

import type { ExtractRequest, ExtractResponse, ExtractedArticle } from './lib/types'

chrome.runtime.onMessage.addListener((message: ExtractRequest, _sender, sendResponse) => {
  if (message?.type !== 'extract') {
    return false
  }
  try {
    const article = extractArticle()
    sendResponse({ ok: true, article } satisfies ExtractResponse)
  } catch (e) {
    sendResponse({
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown extraction error.',
    } satisfies ExtractResponse)
  }
  // Returning true keeps the message channel open for async sendResponse calls.
  // Our extraction here is synchronous, but signalling true is harmless.
  return true
})

function extractArticle(): ExtractedArticle {
  // Readability mutates the document it's given, so clone the live DOM first.
  const docClone = document.cloneNode(/* deep */ true) as Document
  const reader = new Readability(docClone)
  const parsed = reader.parse()

  if (!parsed) {
    throw new Error(
      'Readability could not parse this page. It may be a paywall, a feed listing, ' +
        'an app shell, or content rendered after document_idle.',
    )
  }

  const contentHtml = DOMPurify.sanitize(parsed.content ?? '', {
    USE_PROFILES: { html: true },
  })

  return {
    title: (parsed.title ?? document.title ?? '').trim() || '(untitled)',
    byline: parsed.byline?.trim() || null,
    contentHtml,
    textContent: (parsed.textContent ?? '').trim(),
    excerpt: parsed.excerpt?.trim() || '',
    length: parsed.length ?? 0,
    siteName: parsed.siteName?.trim() || null,
    lang: parsed.lang?.trim() || null,
    url: location.href,
    readerable: isProbablyReaderable(document),
  }
}

console.log('[RSVP Nano Clipper] content script ready on', location.href)
