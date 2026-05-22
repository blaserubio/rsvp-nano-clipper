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
// Fallback extractor — runs when Readability returns suspiciously little.
// Finds the DOM ancestor that contains the most concatenated <p> text and
// returns that container's paragraphs and headings in document order.
// ---------------------------------------------------------------------------

export interface FallbackExtraction {
  text: string
  paragraphCount: number
}

const MIN_PARA_CHARS = 40 // ignore tiny <p>s — usually captions or menu items

export function extractByLargestParagraphContainer(): FallbackExtraction {
  // Score every "reasonable" ancestor by total paragraph text it contains.
  const scores = new Map<Element, number>()
  const allParas = document.querySelectorAll('p')
  for (const p of allParas) {
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
    // Bias toward more specific containers when scores are close.
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
