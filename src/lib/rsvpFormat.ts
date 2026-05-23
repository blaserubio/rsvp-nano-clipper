// Converts an ExtractedArticle into the device's canonical .rsvp text format.
//
// The format is defined by tools/sd_card_converter/convert_books.py in the
// rsvpnano repo (the same converter used to produce the Alice in Wonderland
// fixture). The header is `@rsvp 1` followed by `@title`, optional `@author`,
// and `@source`. The body is a sequence of `@chapter <title>` and `@para`
// directives, with paragraph text wrapped at WRAP_WIDTH columns.
//
// Unicode handling mirrors the device's converter: smart quotes, em-dashes,
// ellipses, and similar Unicode get folded to ASCII; extended Latin
// (é, ñ, ü, ø, Łódź, ě, ő, etc.) is preserved because the firmware renders
// it. Emojis and other glyphs the firmware can't render are stripped.

import type { ExtractedArticle } from './types'

const RSVP_VERSION = '1'
const WRAP_WIDTH = 96

// Mirrors UNICODE_ASCII_REPLACEMENTS in convert_books.py. Keep this in sync
// with the device's converter so our output is byte-equivalent.
const UNICODE_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  // Space-like
  [' ', ' '], [' ', ' '], ['᠎', ' '],
  [' ', ' '], [' ', ' '], [' ', ' '], [' ', ' '],
  [' ', ' '], [' ', ' '], [' ', ' '], [' ', ' '],
  [' ', ' '], [' ', ' '], [' ', ' '],
  [' ', ' '], [' ', ' '], [' ', ' '], [' ', ' '], ['　', ' '],
  // Smart single quotes → '
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"],
  ['′', "'"], ['‵', "'"], ['‹', "'"], ['›', "'"],
  // Smart double quotes → "
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'],
  ['«', '"'], ['»', '"'], ['″', '"'], ['‶', '"'],
  // CJK corner brackets used as quotes
  ['「', '"'], ['」', '"'], ['『', '"'], ['』', '"'],
  // Dashes → -
  ['‐', '-'], ['‑', '-'], ['‒', '-'], ['–', '-'],
  ['—', '-'], ['―', '-'], ['⁃', '-'], ['−', '-'],
  // Ellipsis → ...
  ['…', '...'],
  // Bullets → *
  ['•', '*'], ['·', '*'], ['∙', '*'],
  // Copyright / trademark
  ['©', '(c)'], ['®', '(r)'], ['™', 'TM'],
  // Latin ligatures → letters
  ['ﬀ', 'ff'], ['ﬁ', 'fi'], ['ﬂ', 'fl'],
  ['ﬃ', 'ffi'], ['ﬄ', 'ffl'], ['ﬅ', 'st'], ['ﬆ', 'st'],
  // Unicode replacement character
  ['�', ''],
])

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'P', 'BLOCKQUOTE', 'LI', 'PRE', 'DD', 'DT', 'FIGCAPTION', 'ARTICLE', 'SECTION', 'DIV', 'TR',
])
const HEADING_TAGS: ReadonlySet<string> = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const SKIP_TAGS: ReadonlySet<string> = new Set([
  'SCRIPT', 'STYLE', 'NAV', 'ASIDE', 'NOSCRIPT', 'SVG', 'IFRAME', 'FORM', 'BUTTON',
])

function stripUnrenderable(text: string): string {
  return text
    // Variation selectors
    .replace(/[︀-️]/g, '')
    // Zero-width characters and bidi controls
    .replace(/[​-‏‪-‮⁠]/g, '')
    // Emoji blocks the firmware can't render
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
}

/** Apply Unicode → ASCII replacements, strip unrenderables, collapse whitespace. */
export function normalizeText(text: string): string {
  let out = ''
  for (const ch of text) {
    out += UNICODE_REPLACEMENTS.get(ch) ?? ch
  }
  out = stripUnrenderable(out)
  // Collapse all whitespace runs (including newlines) into single spaces.
  return out.replace(/\s+/g, ' ').trim()
}

/** Sanitise a value for a directive line — no newlines, single line. */
function directiveText(text: string): string {
  return normalizeText(text).replace(/[\r\n]+/g, ' ').trim()
}

type RsvpEvent = { kind: 'chapter'; value: string } | { kind: 'paragraph'; value: string }

/** Walk an HTML string and emit chapter / paragraph events in document order. */
function htmlToEvents(html: string): RsvpEvent[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const events: RsvpEvent[] = []

  function walk(node: Node, parentBuf: string[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
      parentBuf.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as Element
    const tag = el.tagName
    if (SKIP_TAGS.has(tag)) return

    if (tag === 'BR') {
      parentBuf.push(' ')
      return
    }

    if (HEADING_TAGS.has(tag)) {
      const text = (el.textContent ?? '').trim()
      if (text) events.push({ kind: 'chapter', value: text })
      return
    }

    if (BLOCK_TAGS.has(tag)) {
      const buf: string[] = []
      for (const child of Array.from(el.childNodes)) {
        walk(child, buf)
      }
      const text = buf.join('').trim()
      if (text) events.push({ kind: 'paragraph', value: text })
      return
    }

    // Inline element: collect text into the parent block buffer.
    for (const child of Array.from(el.childNodes)) {
      walk(child, parentBuf)
    }
  }

  for (const child of Array.from(doc.body.childNodes)) {
    walk(child, [])
  }
  return events
}

/** Wrap text to the given column width, mirroring the device's converter. */
function wrapToWidth(text: string, width: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line: string[] = []
  let lineLen = 0
  for (const w of words) {
    const projected = lineLen === 0 ? w.length : lineLen + 1 + w.length
    if (lineLen > 0 && projected > width) {
      lines.push(line.join(' '))
      line = [w]
      lineLen = w.length
    } else {
      line.push(w)
      lineLen = projected
    }
  }
  if (line.length) lines.push(line.join(' '))
  return lines.join('\n')
}

export interface RsvpFile {
  filename: string
  /** UTF-8 .rsvp text ready to write to disk. Always ends with a single newline. */
  content: string
  wordCount: number
  chapterCount: number
}

/** Convert an extracted article to a canonical .rsvp file. */
export function articleToRsvp(
  article: ExtractedArticle,
  today: Date = new Date(),
): RsvpFile {
  const title = directiveText(article.title) || 'Untitled'
  const author = directiveText(article.byline ?? '')
  const source = directiveText(article.url || '')

  const events = htmlToEvents(article.contentHtml || '')

  const lines: string[] = [`@rsvp ${RSVP_VERSION}`, `@title ${title}`]
  if (author) lines.push(`@author ${author}`)
  if (source) lines.push(`@source ${source}`)

  let chapterCount = 0
  let lastChapter = ''
  let wordCount = 0

  for (const ev of events) {
    if (ev.kind === 'chapter') {
      const ch = directiveText(ev.value)
      if (!ch || ch === lastChapter) continue
      if (lines[lines.length - 1] !== '') lines.push('')
      lines.push(`@chapter ${ch}`)
      chapterCount++
      lastChapter = ch
      continue
    }
    // paragraph
    const text = normalizeText(ev.value)
    if (!text) continue
    if (wordCount > 0) {
      if (lines[lines.length - 1] !== '') lines.push('')
      lines.push('@para')
    }
    lines.push(wrapToWidth(text, WRAP_WIDTH))
    wordCount += text.split(/\s+/).filter(Boolean).length
  }

  // The device's converter inserts a fallback chapter if none were detected,
  // so the reader always has at least one chapter break.
  if (chapterCount === 0) {
    const headerEnd = findLastHeaderIndex(lines)
    lines.splice(headerEnd + 1, 0, '', `@chapter ${title}`)
    chapterCount = 1
  }

  // Trim any accidental trailing blank lines and ensure a single closing \n.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const content = lines.join('\n') + '\n'

  return {
    filename: buildFilename(title, today, article.publishedDate),
    content,
    wordCount,
    chapterCount,
  }
}

function findLastHeaderIndex(lines: string[]): number {
  let lastHeader = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (l.startsWith('@rsvp ') || l.startsWith('@title ') || l.startsWith('@author ') || l.startsWith('@source ')) {
      lastHeader = i
    } else if (l !== '') {
      break
    }
  }
  return lastHeader
}

/**
 * `YYYY-MM-DD_slugified-title.rsvp`.
 *
 * If `publishedDate` is an ISO date string (`YYYY-MM-DD`), the filename uses
 * that instead of today's date — so a clip of an old article sorts naturally
 * in the Downloads folder by article date rather than clip date. Title is
 * de-dated before slugifying so we don't end up with
 * `2026-05-21_2026-05-21-article-title.rsvp`.
 */
export function buildFilename(
  title: string,
  today: Date = new Date(),
  publishedDate: string | null = null,
): string {
  const datePart = isIsoDateString(publishedDate)
    ? publishedDate
    : today.toISOString().slice(0, 10)
  const slug = slugify(stripLeadingDatePrefix(title), 60)
  return `${datePart}_${slug || 'untitled'}.rsvp`
}

/** URL-safe, lowercase, dash-separated slug; accents stripped. */
export function slugify(text: string, maxLen = 60): string {
  return normalizeText(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '')
}

// ---------------------------------------------------------------------------
// Title-date helpers — used by the popup so titles on the reader carry the
// article's publication date in a compact, sortable prefix.
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const LEADING_DATE_PREFIX_RE = /^\[\d{4}-\d{2}-\d{2}\]\s*/

/** True for strings shaped like `YYYY-MM-DD` (no time component). */
export function isIsoDateString(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

/**
 * Prepend `[YYYY-MM-DD]` to `title` when `publishedDate` is a valid ISO date.
 * If the title already starts with a bracketed date, leaves it alone (idempotent).
 * Returns the unchanged title when no usable date is available.
 */
export function formatTitleWithDate(
  title: string,
  publishedDate: string | null | undefined,
): string {
  const cleanTitle = (title ?? '').trim()
  if (!isIsoDateString(publishedDate)) return cleanTitle
  if (LEADING_DATE_PREFIX_RE.test(cleanTitle)) return cleanTitle
  return `[${publishedDate}] ${cleanTitle}`
}

/** Remove a leading `[YYYY-MM-DD]` (and the single space after it) from `text`. */
export function stripLeadingDatePrefix(text: string): string {
  return (text ?? '').replace(LEADING_DATE_PREFIX_RE, '')
}
