// Content script: stays passive until the popup asks to extract. When asked,
// it (1) warms the page up to reveal lazy/expandable content, (2) runs
// Mozilla Readability, (3) runs a fallback paragraph-cluster extractor, and
// (4) returns whichever produced more substantive body text.

import { isProbablyReaderable, Readability } from '@mozilla/readability'
import DOMPurify from 'dompurify'

import {
  clickExpandButtons,
  extractByLargestParagraphContainer,
  warmUpPage,
} from './lib/pageHelpers'
import type { ExtractRequest, ExtractResponse, ExtractedArticle } from './lib/types'

// Both the manifest's auto-injection and the popup's chrome.scripting fallback
// can land on the same page; without this flag the listener would register
// twice and the extraction would run twice per request.
const FLAG = '__rsvpNanoClipperLoaded'
type GlobalWithFlag = { [FLAG]?: true }
const win = window as unknown as GlobalWithFlag

if (win[FLAG]) {
  console.log('[RSVP Nano Clipper] content script already loaded; skipping')
} else {
  win[FLAG] = true

  chrome.runtime.onMessage.addListener(
    (message: ExtractRequest, _sender, sendResponse) => {
      if (message?.type !== 'extract') {
        return false
      }
      void extractArticle()
        .then((article) => sendResponse({ ok: true, article } satisfies ExtractResponse))
        .catch((e) =>
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : 'Unknown extraction error.',
          } satisfies ExtractResponse),
        )
      // Keep the message channel open while extraction's promise resolves.
      return true
    },
  )

  console.log('[RSVP Nano Clipper] content script ready on', location.href)
}

async function extractArticle(): Promise<ExtractedArticle> {
  // Coax lazy paragraphs into the DOM and click any expand buttons.
  const expandersClicked = clickExpandButtons()
  await warmUpPage()

  // Readability pass.
  const docClone = document.cloneNode(/* deep */ true) as Document
  const reader = new Readability(docClone)
  const parsed = reader.parse()
  const readabilityText = (parsed?.textContent ?? '').trim()
  const readabilityWords = countWords(readabilityText)

  // Fallback pass — runs unconditionally so we can compare.
  const fallback = extractByLargestParagraphContainer()
  const fallbackText = fallback.text
  const fallbackWords = countWords(fallbackText)

  // Pick whichever has substantially more readable content. We require
  // fallback to beat Readability by at least 40% to avoid trading away
  // Readability's good cleanup for marginal gains.
  let method: 'readability' | 'fallback'
  let finalText: string
  let finalHtml: string

  if (
    readabilityWords > 0 &&
    readabilityWords * 1.4 >= fallbackWords
  ) {
    method = 'readability'
    finalText = readabilityText
    finalHtml = DOMPurify.sanitize(parsed?.content ?? '', {
      USE_PROFILES: { html: true },
    })
  } else if (fallbackWords > 0) {
    method = 'fallback'
    finalText = fallbackText
    // Wrap the fallback text in <p> tags so the eventual rsvp converter sees
    // paragraph structure the same way it does for Readability output.
    finalHtml = DOMPurify.sanitize(
      fallbackText
        .split('\n\n')
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('\n'),
      { USE_PROFILES: { html: true } },
    )
  } else {
    // Nothing worked.
    throw new Error(
      'Could not extract any readable text from this page. ' +
        'It may be a paywall, an app shell, or content rendered after our wait.',
    )
  }

  return {
    title: (parsed?.title ?? document.title ?? '').trim() || '(untitled)',
    byline: parsed?.byline?.trim() || null,
    contentHtml: finalHtml,
    textContent: finalText,
    excerpt: parsed?.excerpt?.trim() || '',
    length: finalText.length,
    siteName: parsed?.siteName?.trim() || null,
    lang: parsed?.lang?.trim() || null,
    url: location.href,
    readerable: isProbablyReaderable(document),
    method,
    diagnostics: {
      readabilityWords,
      fallbackWords,
      expandersClicked,
    },
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
