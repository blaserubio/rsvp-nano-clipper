// Helpers that run inside the page (content-script world) to coax stubborn
// sites into revealing their full article body before Readability runs.
//
// Two real-world failure modes we're working around:
//   1. "Story Continues" / "Read more" expanders that gate the back half
//      of the article behind a click (Yahoo Finance, MSN, Forbes, etc.).
//   2. Lazy-loaded paragraphs that only render when the viewport reaches
//      them, so a fresh document.cloneNode at document_idle sees a stub.

const EXPAND_PATTERNS: RegExp[] = [
  /story continues/i,
  /continue reading/i,
  /read (the )?(full |rest of |more)/i,
  /show more/i,
  /view more/i,
  /load more/i,
  /see more/i,
  /full (article|story)/i,
  /expand/i,
  /show full/i,
]

// Anything matching these is almost certainly NOT the kind of button we want
// to click — registrations, paywalls, comment forms, share menus, etc.
const NEGATIVE_PATTERNS: RegExp[] = [
  /subscribe/i,
  /sign\s*(up|in)/i,
  /log\s*in/i,
  /register/i,
  /create account/i,
  /paywall/i,
  /premium/i,
  /email/i,
  /newsletter/i,
  /comments?/i,
  /reply/i,
  /share/i,
  /follow/i,
  /save/i,
  /bookmark/i,
  /cookies?/i,
  /accept all/i,
]

function elementLabel(el: Element): string {
  const html = el as HTMLElement
  const text = (html.innerText ?? html.textContent ?? '').trim()
  const aria = el.getAttribute('aria-label')?.trim() ?? ''
  return text || aria
}

function isVisible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.offsetParent === null) return false
  const rect = html.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isExpandButton(el: Element): boolean {
  const label = elementLabel(el)
  if (!label) return false
  if (label.length > 80) return false // long labels are usually not buttons
  if (NEGATIVE_PATTERNS.some((re) => re.test(label))) return false
  return EXPAND_PATTERNS.some((re) => re.test(label))
}

/** Click any visible "Show more / Story continues / Read more" buttons. */
export function clickExpandButtons(): number {
  const candidates = document.querySelectorAll<HTMLElement>(
    'button, a, [role="button"], summary',
  )
  let clicks = 0
  for (const el of candidates) {
    if (!isVisible(el)) continue
    if (!isExpandButton(el)) continue
    try {
      el.click()
      clicks++
      if (clicks >= 5) break // safety cap
    } catch {
      /* ignore individual click failures */
    }
  }
  return clicks
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Warm the page up before extraction so lazy paragraphs render and any
 * "expand" buttons get clicked. Total wall-clock cost: ~1.2 seconds.
 * Caller will see a brief scroll flash; we restore the original position.
 */
export async function warmUpPage(): Promise<void> {
  const originalScroll = window.scrollY

  // Round 1: click expand buttons that are already on screen.
  clickExpandButtons()
  await sleep(150)

  // Trigger any IntersectionObserver-driven lazy loads by walking the page
  // in 6 steps from top to bottom.
  const steps = 6
  for (let i = 1; i <= steps; i++) {
    const top = (document.documentElement.scrollHeight * i) / steps
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior })
    await sleep(110)
  }

  // Round 2: expand buttons may have been revealed by the lazy load above.
  clickExpandButtons()
  await sleep(250)

  // Restore the user's original scroll position so the page doesn't look
  // disturbed when the popup closes.
  window.scrollTo({ top: originalScroll, behavior: 'instant' as ScrollBehavior })
}

// ---------------------------------------------------------------------------
// Junk filtering — strip ads, nav, social, related-articles, newsletter
// signup blocks, comments, etc., so neither extractor pulls them in.
// ---------------------------------------------------------------------------

// Tags whose contents are ~never article body.
const ALWAYS_JUNK_TAGS = new Set([
  'NAV',
  'IFRAME',
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'BUTTON',
  'FORM',
  'INPUT',
  'SELECT',
  'TEXTAREA',
])

// Tags that are junk only OUTSIDE the article container (page chrome
// vs. inside <article>, where they may legitimately hold pullquotes or
// inline notes).
const CONTEXTUAL_JUNK_TAGS = new Set(['ASIDE', 'HEADER', 'FOOTER'])

// ARIA roles that mark page chrome rather than article content.
const JUNK_ROLES = new Set([
  'banner',
  'navigation',
  'contentinfo',
  'complementary',
  'search',
  'dialog',
  'alertdialog',
])

// Class / id substrings that very reliably indicate non-article content.
// Conservative — must be a recognisable word, not a stray substring.
const JUNK_CLASS_ID_REGEX =
  /(^|[\s_-])(advertis|sponsor(ed)?|promo(ted)?|newsletter|subscribe|signup|sign-up|related-articl|related-stor|related-content|recommendation|recommended|social-share|share-bar|share-buttons|sharing-tools|comment-section|comments?-wrapper|comments?-list|comments?-container|trending(-|$)|tag-list|tags-list|byline|caas-readmore|caas-share|caas-related|caas-newsletter|paywall|register-wall|cookie-banner|gdpr|consent-banner)(?=$|[\s_-])/i

function attrText(el: Element, name: string): string {
  const v = el.getAttribute(name)
  return v == null ? '' : v.toLowerCase()
}

function classAndIdText(el: Element): string {
  const className =
    typeof (el as HTMLElement).className === 'string'
      ? ((el as HTMLElement).className as string)
      : ''
  return `${className.toLowerCase()} ${(el.id ?? '').toLowerCase()}`
}

export function isJunkElement(el: Element, articleRoot?: Element | null): boolean {
  const tag = el.tagName
  if (ALWAYS_JUNK_TAGS.has(tag)) return true
  if (CONTEXTUAL_JUNK_TAGS.has(tag)) {
    // Strip if we're outside the article root (page chrome).
    if (!articleRoot || !articleRoot.contains(el)) return true
    // Inside the article: only strip if it ALSO matches a junk class.
    if (JUNK_CLASS_ID_REGEX.test(classAndIdText(el))) return true
    return false
  }

  const role = attrText(el, 'role')
  if (role && JUNK_ROLES.has(role)) return true

  const aria = attrText(el, 'aria-label')
  if (
    aria &&
    /(advertis|sponsor|newsletter|related|recommend|comments?|social|share|trending|subscribe|sign\s*up)/i.test(
      aria,
    )
  ) {
    return true
  }

  if (el.hasAttribute('data-ad') || el.hasAttribute('data-ads')) return true
  if (attrText(el, 'data-testid').includes('ad')) {
    // be picky: must be a word-boundary "ad", not "address" / "shadow"
    if (/(^|[\s_-])ads?(?=$|[\s_-])/i.test(attrText(el, 'data-testid'))) return true
  }

  return JUNK_CLASS_ID_REGEX.test(classAndIdText(el))
}

/**
 * Remove junk elements from a *clone* of the document. Returns the count of
 * elements removed. Never call this on the live page — mutating the user's
 * page is a UX violation.
 */
export function removeJunkNodes(root: Document | Element): number {
  // Article-aware: <aside>/<header>/<footer> inside the main <article> may
  // be legitimate, while the same tags outside it are page chrome.
  const articleRoot =
    (root as Document).querySelector?.('article') ??
    (root instanceof Element ? root.querySelector('article') : null)
  const all = Array.from(
    (root as Document).querySelectorAll?.('*') ??
      (root instanceof Element ? root.querySelectorAll('*') : []),
  )
  let removed = 0
  for (const el of all) {
    if (!el.isConnected) continue // already removed via an ancestor
    if (isJunkElement(el, articleRoot)) {
      el.remove()
      removed++
    }
  }
  return removed
}

/**
 * Does any ancestor of `el` (up to `stopAt`) qualify as junk?
 * Used by the fallback extractor on the live DOM so we don't have to mutate.
 */
function hasJunkAncestor(el: Element, articleRoot: Element | null): boolean {
  let cur: Element | null = el
  while (cur && cur !== document.body) {
    if (isJunkElement(cur, articleRoot)) return true
    cur = cur.parentElement
  }
  return false
}

// ---------------------------------------------------------------------------
// Text-level cleanup — drops paragraphs that survived the DOM filter but
// are still obvious boilerplate (ad labels, signup CTAs, share prompts).
// ---------------------------------------------------------------------------

const TEXT_JUNK_PATTERNS: RegExp[] = [
  /^advertisement$/i,
  /^advertisement\s*[:\-—]/i,
  /^sponsored(\s+content)?$/i,
  /^sponsored\s*[:\-—]/i,
  /story continues below( advertisement)?/i,
  /this advertisement has not loaded yet/i,
  /^sign\s*up for (the|our)/i,
  /^subscribe to (the|our|read)/i,
  /^follow us on/i,
  /^share this (article|story|post)/i,
  /^(read|related|see also|also read|more from|read more)\s*[:\-—]/i,
  /^click here to/i,
  /this article (originally|first) appeared on/i,
  /we may earn (a )?commission/i,
  /^affiliate links?/i,
  /^by clicking accept/i,
  /^we use cookies/i,
  /^manage (your )?preferences$/i,
  /^join the (conversation|discussion)/i,
  /^download the .* app/i,
]

// Standalone metadata lines: "5 Comments", "1.2k shares", "8 min read",
// "Updated 3 hours ago" — these are widgets, not article content.
const TEXT_METADATA_REGEX =
  /^(\d[\d,.kKmM]*\s*(comments?|shares?|likes?|reactions?|views?|reads?)|(\d+\s*min(ute)?s?\s*read)|(updated|published|posted)\s+(on\s+)?[\w\s,:\-—\d]+(ago)?)$/i

function looksLikeArticleProse(text: string): boolean {
  // Strip URLs and symbols, then require enough letters that this isn't
  // a stock-ticker row or numeric widget being extracted as text.
  const stripped = text.replace(/https?:\/\/\S+/g, '').trim()
  if (stripped.length === 0) return false
  const letterCount = stripped.replace(/[^a-zA-Z]/g, '').length
  return letterCount >= Math.max(20, stripped.length * 0.4)
}

/** Final cleanup pass on the already-extracted article body. */
export function cleanArticleText(text: string): string {
  const paragraphs = text.split(/\r?\n{2,}/)
  const kept: string[] = []
  for (const raw of paragraphs) {
    const p = raw.replace(/\s+/g, ' ').trim()
    if (p.length === 0) continue
    if (TEXT_JUNK_PATTERNS.some((re) => re.test(p))) continue
    if (TEXT_METADATA_REGEX.test(p)) continue
    if (!looksLikeArticleProse(p)) continue
    kept.push(p)
  }
  return kept.join('\n\n')
}

// ---------------------------------------------------------------------------
// Fallback extractor — runs on the LIVE document (we can't take its layout
// without it). Skips paragraphs whose ancestors look like ads/nav/etc.
// ---------------------------------------------------------------------------

export interface FallbackExtraction {
  text: string
  paragraphCount: number
}

const MIN_PARA_CHARS = 40 // ignore tiny <p>s — usually captions or menu items

export function extractByLargestParagraphContainer(): FallbackExtraction {
  const articleRoot = document.querySelector('article')
  // Score every "reasonable" ancestor by total paragraph text it contains,
  // but only for paragraphs that aren't inside something junky.
  const scores = new Map<Element, number>()
  const allParas = document.querySelectorAll('p')
  for (const p of allParas) {
    if (hasJunkAncestor(p, articleRoot)) continue
    const text = ((p as HTMLElement).innerText ?? '').trim()
    if (text.length < MIN_PARA_CHARS) continue
    let ancestor: Element | null = p.parentElement
    for (let depth = 0; depth < 5 && ancestor; depth++) {
      scores.set(ancestor, (scores.get(ancestor) ?? 0) + text.length)
      ancestor = ancestor.parentElement
    }
  }

  let bestEl: Element | null = null
  let bestScore = 0
  for (const [el, score] of scores) {
    if (score > bestScore) {
      bestScore = score
      bestEl = el
    }
  }
  if (!bestEl) return { text: '', paragraphCount: 0 }

  const blocks = bestEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6')
  const lines: string[] = []
  let paragraphCount = 0
  for (const block of blocks) {
    if (hasJunkAncestor(block, articleRoot)) continue
    const text = ((block as HTMLElement).innerText ?? '').trim()
    if (block.tagName === 'P') {
      if (text.length < 20) continue
      lines.push(text)
      paragraphCount++
    } else {
      if (text.length === 0) continue
      lines.push(text)
    }
  }
  return { text: lines.join('\n\n'), paragraphCount }
}
