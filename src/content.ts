// Content script: stays passive until the popup asks it to do something.
// Handles four messages:
//   { type: 'extract' }                      → run the article extractor
//   { type: 'highlight', textContent: ... }  → visually mark live elements
//   { type: 'unhighlight' }                  → remove all highlights
//   { type: 'scroll', which: 'first'|'last' } → scroll to a kept element

import { isProbablyReaderable, Readability } from '@mozilla/readability'
import DOMPurify from 'dompurify'

import {
  clickExpandButtons,
  cleanArticleText,
  extractAllArticleParagraphs,
  removeJunkNodes,
  warmUpPage,
} from './lib/pageHelpers'
import type {
  ContentMessage,
  ExtractResponse,
  ExtractedArticle,
  SimpleResponse,
} from './lib/types'

// Both the manifest's auto-injection and the popup's chrome.scripting fallback
// can land on the same page; without this flag the listener would register
// twice and every action would run twice per request.
const FLAG = '__rsvpNanoClipperLoaded'
type GlobalWithFlag = { [FLAG]?: true }
const win = window as unknown as GlobalWithFlag

if (win[FLAG]) {
  console.log('[RSVP Nano Clipper] content script already loaded; skipping')
} else {
  win[FLAG] = true

  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    switch (message?.type) {
      case 'extract': {
        void extractArticle()
          .then((article) =>
            sendResponse({ ok: true, article } satisfies ExtractResponse),
          )
          .catch((e) =>
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : 'Unknown extraction error.',
            } satisfies ExtractResponse),
          )
        return true
      }
      case 'highlight': {
        try {
          const count = applyHighlight(message.textContent)
          sendResponse({ ok: true, count } satisfies SimpleResponse)
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : 'highlight failed',
          } satisfies SimpleResponse)
        }
        return false
      }
      case 'unhighlight': {
        const count = clearHighlight()
        sendResponse({ ok: true, count } satisfies SimpleResponse)
        return false
      }
      case 'scroll': {
        const ok = scrollToKept(message.which)
        sendResponse({
          ok: true,
          count: ok ? 1 : 0,
        } satisfies SimpleResponse)
        return false
      }
      default:
        return false
    }
  })

  console.log('[RSVP Nano Clipper] content script ready on', location.href)
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

async function extractArticle(): Promise<ExtractedArticle> {
  const expandersClicked = clickExpandButtons()
  await warmUpPage()

  const docClone = document.cloneNode(/* deep */ true) as Document
  const junkRemoved = removeJunkNodes(docClone)
  const reader = new Readability(docClone)
  const parsed = reader.parse()
  const readabilityRaw = (parsed?.textContent ?? '').trim()
  const readabilityClean = cleanArticleText(readabilityRaw)
  const readabilityWords = countWords(readabilityClean)

  const fallbackRaw = extractAllArticleParagraphs().text
  const fallbackClean = cleanArticleText(fallbackRaw)
  const fallbackWords = countWords(fallbackClean)

  let method: 'readability' | 'fallback'
  let finalText: string
  let finalHtml: string

  if (readabilityWords > 0 && readabilityWords * 1.4 >= fallbackWords) {
    method = 'readability'
    finalText = readabilityClean
    finalHtml = DOMPurify.sanitize(parsed?.content ?? '', {
      USE_PROFILES: { html: true },
    })
  } else if (fallbackWords > 0) {
    method = 'fallback'
    finalText = fallbackClean
    finalHtml = DOMPurify.sanitize(
      fallbackClean
        .split('\n\n')
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('\n'),
      { USE_PROFILES: { html: true } },
    )
  } else {
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
    publishedDate: extractPublishedDate(parsed),
    method,
    diagnostics: {
      readabilityWords,
      fallbackWords,
      expandersClicked,
      junkRemoved,
    },
  }
}

// ---------------------------------------------------------------------------
// Published-date extraction.
// First hit wins, in order: Readability's own publishedTime → common meta
// tags → <time datetime> inside the article → JSON-LD datePublished.
// All values normalised to ISO YYYY-MM-DD; invalid dates return null.
// ---------------------------------------------------------------------------

interface ReadabilityWithDate {
  publishedTime?: string | null
}

function extractPublishedDate(parsed: unknown): string | null {
  // 1. Readability — covers most modern news/blog sites already.
  const rPublished = (parsed as ReadabilityWithDate | null | undefined)
    ?.publishedTime
  let iso = toIsoDate(rPublished ?? null)
  if (iso) return iso

  // 2. Common meta tags.
  const metaSelectors: Array<[string, string]> = [
    ['meta[property="article:published_time"]', 'content'],
    ['meta[name="article:published_time"]', 'content'],
    ['meta[itemprop="datePublished"]', 'content'],
    ['meta[name="date"]', 'content'],
    ['meta[name="pubdate"]', 'content'],
    ['meta[name="DC.date.issued"]', 'content'],
    ['meta[name="dcterms.created"]', 'content'],
    ['meta[name="parsely-pub-date"]', 'content'],
    ['meta[name="sailthru.date"]', 'content'],
  ]
  for (const [selector, attr] of metaSelectors) {
    const el = document.querySelector(selector)
    iso = toIsoDate(el?.getAttribute(attr) ?? null)
    if (iso) return iso
  }

  // 3. <time datetime="…"> inside the main article container (or document).
  const articleRoot = document.querySelector('article')
  const time =
    (articleRoot ?? document).querySelector('time[datetime]') ??
    document.querySelector('time[datetime]')
  iso = toIsoDate(time?.getAttribute('datetime') ?? null)
  if (iso) return iso

  // 4. JSON-LD datePublished. Pages can embed multiple LD blocks and even
  // arrays of objects; walk them tolerantly.
  const ldScripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )
  for (const script of ldScripts) {
    const raw = (script.textContent ?? '').trim()
    if (!raw) continue
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    const candidates = Array.isArray(data) ? data : [data]
    for (const item of candidates) {
      if (item && typeof item === 'object') {
        const dp = (item as Record<string, unknown>).datePublished
        if (typeof dp === 'string') {
          iso = toIsoDate(dp)
          if (iso) return iso
        }
      }
    }
  }

  return null
}

function toIsoDate(raw: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Highlight / unhighlight / scroll
// ---------------------------------------------------------------------------

const HIGHLIGHT_CLASS = '__rsvp-clipper-kept'
const STYLE_ID = '__rsvp-clipper-style'
const NEEDLE_LEN = 40
const MIN_NEEDLE_LEN = 20

// We remember the elements we last highlighted so scrollToKept('first'|'last')
// can jump to a stable position without having to re-match.
type ClipperGlobals = GlobalWithFlag & {
  __rsvpHighlighted?: Element[]
}
const winState = win as ClipperGlobals

function injectHighlightStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background-color: rgba(34, 197, 94, 0.14) !important;
      border-left: 3px solid rgba(34, 197, 94, 0.7) !important;
      padding-left: 8px !important;
      box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.18) !important;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
  `
  document.head.appendChild(style)
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”„‟"]/g, '')
    .replace(/[‘’‚‛']/g, '')
    .replace(/[—–]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
}

function findKeptElements(extractedText: string): Element[] {
  // Build one big normalised haystack from the entire extracted body. Any live
  // element whose opening text (a substring "needle") appears anywhere in it
  // is considered kept. This is much more forgiving than exact paragraph-
  // boundary matching, because Readability sometimes merges or splits
  // paragraphs relative to the live DOM, and we want EVERY surviving block
  // marked, not just the ones whose paragraph break aligned.
  const haystack = normalizeForMatch(extractedText)
  if (haystack.length < MIN_NEEDLE_LEN) return []

  const matched: Element[] = []
  const candidates = document.querySelectorAll<HTMLElement>(
    'p, h1, h2, h3, h4, h5, h6, li, blockquote',
  )
  for (const el of candidates) {
    const text = (el.innerText ?? '').trim()
    if (text.length < MIN_NEEDLE_LEN) continue
    const normalised = normalizeForMatch(text)
    if (normalised.length < MIN_NEEDLE_LEN) continue
    const needle = normalised.slice(0, NEEDLE_LEN)
    if (needle.length < MIN_NEEDLE_LEN) continue
    if (haystack.includes(needle)) matched.push(el)
  }
  // De-dup by reference (querySelectorAll already returns a unique set, but
  // headings and paragraphs can in theory be nested so be safe).
  return Array.from(new Set(matched))
}

function applyHighlight(extractedText: string): number {
  clearHighlight()
  const elements = findKeptElements(extractedText)
  if (elements.length === 0) return 0
  injectHighlightStyle()
  for (const el of elements) {
    el.classList.add(HIGHLIGHT_CLASS)
  }
  winState.__rsvpHighlighted = elements
  return elements.length
}

function clearHighlight(): number {
  let count = 0
  const tracked = winState.__rsvpHighlighted ?? []
  for (const el of tracked) {
    if (!el.isConnected) continue
    el.classList.remove(HIGHLIGHT_CLASS)
    count++
  }
  // Also sweep the DOM in case anything still has the class (defensive).
  for (const el of document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) {
    el.classList.remove(HIGHLIGHT_CLASS)
  }
  winState.__rsvpHighlighted = []
  return count
}

function scrollToKept(which: 'first' | 'last'): boolean {
  const tracked = (winState.__rsvpHighlighted ?? []).filter((el) => el.isConnected)
  if (tracked.length === 0) return false
  const target = which === 'first' ? tracked[0] : tracked[tracked.length - 1]
  if (!target) return false
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Briefly flash the target so the user's eye lands on it.
  ;(target as HTMLElement).animate(
    [
      { backgroundColor: 'rgba(34, 197, 94, 0.55)' },
      { backgroundColor: 'rgba(34, 197, 94, 0.14)' },
    ],
    { duration: 900, easing: 'ease-out' },
  )
  return true
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
