import { describe, expect, it } from 'vitest'

import {
  articleToRsvp,
  buildFilename,
  formatTitleWithDate,
  isIsoDateString,
  normalizeText,
  slugify,
  stripLeadingDatePrefix,
} from '../src/lib/rsvpFormat'
import type { ExtractedArticle } from '../src/lib/types'

function makeArticle(overrides: Partial<ExtractedArticle> = {}): ExtractedArticle {
  return {
    title: 'Test Article',
    byline: 'Jane Doe',
    contentHtml: '<p>Hello world.</p>',
    textContent: 'Hello world.',
    excerpt: '',
    length: 12,
    siteName: 'Example',
    lang: 'en',
    url: 'https://example.com/article',
    readerable: true,
    publishedDate: null,
    method: 'readability',
    diagnostics: {
      readabilityWords: 2,
      fallbackWords: 0,
      expandersClicked: 0,
      junkRemoved: 0,
    },
    ...overrides,
  }
}

const FIXED_DATE = new Date('2026-05-21T12:00:00Z')

// ---------------------------------------------------------------------------
// Header / metadata
// ---------------------------------------------------------------------------

describe('articleToRsvp — header', () => {
  it('emits @rsvp 1 as the first line', () => {
    const out = articleToRsvp(makeArticle(), FIXED_DATE)
    expect(out.content.split('\n')[0]).toBe('@rsvp 1')
  })

  it('emits @title, @author, and @source', () => {
    const out = articleToRsvp(makeArticle(), FIXED_DATE)
    expect(out.content).toContain('@title Test Article')
    expect(out.content).toContain('@author Jane Doe')
    expect(out.content).toContain('@source https://example.com/article')
  })

  it('omits @author when byline is missing', () => {
    const out = articleToRsvp(makeArticle({ byline: null }), FIXED_DATE)
    expect(out.content).not.toContain('@author')
  })

  it('omits @author when byline is an empty string', () => {
    const out = articleToRsvp(makeArticle({ byline: '   ' }), FIXED_DATE)
    expect(out.content).not.toContain('@author')
  })

  it('strips newlines from directive values', () => {
    const out = articleToRsvp(
      makeArticle({ title: 'Multi\nline\ntitle' }),
      FIXED_DATE,
    )
    const titleLine = out.content
      .split('\n')
      .find((l) => l.startsWith('@title '))
    expect(titleLine).toBe('@title Multi line title')
  })

  it('falls back to "Untitled" when the title is empty', () => {
    const out = articleToRsvp(makeArticle({ title: '' }), FIXED_DATE)
    expect(out.content).toContain('@title Untitled')
  })
})

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

describe('articleToRsvp — chapters', () => {
  it('falls back to a chapter named after the title when none in the HTML', () => {
    const out = articleToRsvp(makeArticle(), FIXED_DATE)
    expect(out.content).toContain('@chapter Test Article')
    expect(out.chapterCount).toBe(1)
  })

  it('maps H1 / H2 / H3 / H4 to chapters', () => {
    const html = `
      <h2>First Section</h2>
      <p>Some text.</p>
      <h3>Subsection</h3>
      <p>More text.</p>
      <h2>Second Section</h2>
      <p>Yet more.</p>
    `
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.chapterCount).toBe(3)
    expect(out.content).toContain('@chapter First Section')
    expect(out.content).toContain('@chapter Subsection')
    expect(out.content).toContain('@chapter Second Section')
  })

  it('does not emit duplicate consecutive chapter titles', () => {
    const html = '<h2>Same</h2><h2>Same</h2><p>body</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.chapterCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------

describe('articleToRsvp — paragraphs', () => {
  it('emits @para before every paragraph after the first', () => {
    const html = '<p>One.</p><p>Two.</p><p>Three.</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    const paraCount = (out.content.match(/^@para$/gm) ?? []).length
    expect(paraCount).toBe(2)
  })

  it('counts words across all paragraphs', () => {
    const html = '<p>One two three.</p><p>Four five.</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.wordCount).toBe(5)
  })

  it('wraps long paragraph text at 96 columns', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const out = articleToRsvp(makeArticle({ contentHtml: `<p>${long}</p>` }), FIXED_DATE)
    const bodyLines = out.content
      .split('\n')
      .filter((l) => l.length > 0 && !l.startsWith('@'))
    expect(bodyLines.length).toBeGreaterThan(1)
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(96)
    }
  })

  it('treats <br> as inline whitespace within a paragraph', () => {
    const html = '<p>Line one.<br>Line two.</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.content).toMatch(/Line one\. Line two\./)
  })

  it('skips empty paragraphs', () => {
    const html = '<p>   </p><p>Real content.</p><p></p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    const paraCount = (out.content.match(/^@para$/gm) ?? []).length
    expect(paraCount).toBe(0) // only one real para, so no @para directive needed
    expect(out.content).toContain('Real content.')
  })
})

// ---------------------------------------------------------------------------
// Unicode normalisation
// ---------------------------------------------------------------------------

describe('articleToRsvp — Unicode', () => {
  it('folds smart quotes to ASCII', () => {
    const html = `<p>“Hello” and ‘world.’</p>`
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.content).toContain('"Hello" and \'world.\'')
  })

  it('folds em-dashes and en-dashes to ASCII hyphens', () => {
    const html = '<p>He said—really—it was fine — yes.</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.content).not.toMatch(/[—–]/)
    expect(out.content).toMatch(/He said-really-it was fine - yes\./)
  })

  it('folds the ellipsis character to three dots', () => {
    const html = '<p>Wait… really?</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.content).toContain('Wait... really?')
  })

  it('preserves accented Latin characters the firmware supports', () => {
    const html = '<p>café, naïve, jalapeño, Łódź, schön, žubr, élève</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.content).toContain('café')
    expect(out.content).toContain('naïve')
    expect(out.content).toContain('jalapeño')
    expect(out.content).toContain('Łódź')
    expect(out.content).toContain('schön')
    expect(out.content).toContain('žubr')
    expect(out.content).toContain('élève')
  })

  it('strips emojis and zero-width characters', () => {
    const html = '<p>Hello 😀​ world 🎉 thumbs 👍 ok.</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.content).not.toMatch(/[😀🎉👍]/u)
    expect(out.content).not.toContain('​')
    expect(out.content).toMatch(/Hello\s+world\s+thumbs\s+ok\./)
  })

  it('collapses runs of whitespace inside paragraphs', () => {
    const html = '<p>too    many\n\n\t spaces   here.</p>'
    const out = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(out.content).toContain('too many spaces here.')
  })
})

describe('normalizeText', () => {
  it('returns empty string for whitespace-only input', () => {
    expect(normalizeText('   \n\t  ')).toBe('')
  })
  it('replaces ligatures with their letter equivalents', () => {
    expect(normalizeText('ﬁeld ofﬃce')).toBe('field offfice')
  })
})

// ---------------------------------------------------------------------------
// Slugify + filename
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and dashes non-alphanumeric runs', () => {
    expect(slugify("Hello, World! How's it going?")).toBe('hello-world-how-s-it-going')
  })

  it('strips diacritics from accented characters', () => {
    expect(slugify('Café résumé naïve')).toBe('cafe-resume-naive')
  })

  it('respects the max length and never ends with a dash', () => {
    const s = slugify('this is a really very quite long title indeed', 20)
    expect(s.length).toBeLessThanOrEqual(20)
    expect(s).not.toMatch(/-$/)
  })

  it('returns an empty string when there are no alphanumerics', () => {
    expect(slugify('!!! --- ???')).toBe('')
  })
})

describe('buildFilename', () => {
  it('emits YYYY-MM-DD_slug.rsvp', () => {
    expect(buildFilename('My Test Article', FIXED_DATE)).toBe(
      '2026-05-21_my-test-article.rsvp',
    )
  })

  it('falls back to "untitled" when the title slugs to nothing', () => {
    expect(buildFilename('???', FIXED_DATE)).toBe('2026-05-21_untitled.rsvp')
  })
})

// ---------------------------------------------------------------------------
// End-to-end / idempotency
// ---------------------------------------------------------------------------

describe('articleToRsvp — round-trip / idempotency', () => {
  it('produces byte-identical output for the same input', () => {
    const html = '<h2>Section</h2><p>Body text here.</p>'
    const a = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    const b = articleToRsvp(makeArticle({ contentHtml: html }), FIXED_DATE)
    expect(a.content).toBe(b.content)
    expect(a.filename).toBe(b.filename)
    expect(a.wordCount).toBe(b.wordCount)
    expect(a.chapterCount).toBe(b.chapterCount)
  })

  it('content always ends with exactly one trailing newline', () => {
    const out = articleToRsvp(makeArticle(), FIXED_DATE)
    expect(out.content.endsWith('\n')).toBe(true)
    expect(out.content.endsWith('\n\n')).toBe(false)
  })

  it('produces a structurally valid .rsvp file for a realistic article', () => {
    const html = `
      <h1>The Article Title</h1>
      <p>Lead paragraph with “quotes” and an em—dash.</p>
      <h2>First Section</h2>
      <p>First section body, with some <em>emphasis</em> and a link
      <a href="https://example.com">like this</a>.</p>
      <h2>Second Section</h2>
      <p>Multiple paragraphs.</p>
      <p>Another one.</p>
    `
    const out = articleToRsvp(
      makeArticle({
        title: 'The Article Title',
        contentHtml: html,
        byline: 'A. Writer',
        url: 'https://news.example.com/the-article-title',
      }),
      FIXED_DATE,
    )

    const text = out.content
    expect(text.startsWith('@rsvp 1\n@title The Article Title\n')).toBe(true)
    expect(text).toContain('@author A. Writer')
    expect(text).toContain('@source https://news.example.com/the-article-title')
    expect(out.chapterCount).toBeGreaterThanOrEqual(2)
    expect(out.wordCount).toBeGreaterThan(0)
    expect(text).toContain('"quotes"')
    expect(text).not.toMatch(/[—“”‘’]/) // smart punctuation folded
  })
})

// ---------------------------------------------------------------------------
// v1.2 — title-with-date helpers
// ---------------------------------------------------------------------------

describe('isIsoDateString', () => {
  it('accepts well-formed YYYY-MM-DD strings', () => {
    expect(isIsoDateString('2026-05-21')).toBe(true)
    expect(isIsoDateString('1999-01-01')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isIsoDateString(null)).toBe(false)
    expect(isIsoDateString(undefined)).toBe(false)
    expect(isIsoDateString('')).toBe(false)
    expect(isIsoDateString('2026-5-21')).toBe(false)
    expect(isIsoDateString('2026-05-21T12:00:00Z')).toBe(false)
    expect(isIsoDateString('May 21, 2026')).toBe(false)
  })
})

describe('formatTitleWithDate', () => {
  it('prepends [YYYY-MM-DD] when a valid date is provided', () => {
    expect(formatTitleWithDate('Hello World', '2026-05-21')).toBe(
      '[2026-05-21] Hello World',
    )
  })

  it('returns the title unchanged when publishedDate is null', () => {
    expect(formatTitleWithDate('Hello World', null)).toBe('Hello World')
  })

  it('returns the title unchanged when publishedDate is undefined', () => {
    expect(formatTitleWithDate('Hello World', undefined)).toBe('Hello World')
  })

  it('returns the title unchanged for ill-formed dates', () => {
    expect(formatTitleWithDate('Hello', '2026-5-21')).toBe('Hello')
    expect(formatTitleWithDate('Hello', 'tomorrow')).toBe('Hello')
  })

  it('is idempotent — does not double-prepend a date already in the title', () => {
    expect(
      formatTitleWithDate('[2026-05-21] Hello World', '2026-05-21'),
    ).toBe('[2026-05-21] Hello World')
  })

  it('trims surrounding whitespace from the title', () => {
    expect(formatTitleWithDate('   Hello   ', '2026-05-21')).toBe(
      '[2026-05-21] Hello',
    )
  })
})

describe('stripLeadingDatePrefix', () => {
  it('removes a leading [YYYY-MM-DD] and the space after it', () => {
    expect(stripLeadingDatePrefix('[2026-05-21] Foo')).toBe('Foo')
  })

  it('handles multiple spaces between the prefix and title', () => {
    expect(stripLeadingDatePrefix('[2026-05-21]   Foo')).toBe('Foo')
  })

  it('leaves the string unchanged when the date is not at the start', () => {
    expect(stripLeadingDatePrefix('Foo [2026-05-21]')).toBe('Foo [2026-05-21]')
  })

  it('leaves malformed bracketed prefixes alone', () => {
    expect(stripLeadingDatePrefix('[bad-date] Foo')).toBe('[bad-date] Foo')
    expect(stripLeadingDatePrefix('[2026-5-21] Foo')).toBe('[2026-5-21] Foo')
  })

  it('handles empty / null-ish inputs without crashing', () => {
    expect(stripLeadingDatePrefix('')).toBe('')
  })
})

describe('buildFilename — article date awareness', () => {
  it('uses the article date when provided', () => {
    expect(
      buildFilename('My Article', new Date('2026-05-21T00:00:00Z'), '2024-01-15'),
    ).toBe('2024-01-15_my-article.rsvp')
  })

  it('falls back to today when publishedDate is null', () => {
    expect(
      buildFilename('My Article', new Date('2026-05-21T00:00:00Z'), null),
    ).toBe('2026-05-21_my-article.rsvp')
  })

  it('ignores publishedDate when it is not a valid YYYY-MM-DD', () => {
    expect(
      buildFilename('My Article', new Date('2026-05-21T00:00:00Z'), 'tomorrow'),
    ).toBe('2026-05-21_my-article.rsvp')
  })

  it('strips a leading [YYYY-MM-DD] from the title before slugifying', () => {
    expect(
      buildFilename(
        '[2026-05-21] My Article',
        new Date('2026-05-21T00:00:00Z'),
        '2026-05-21',
      ),
    ).toBe('2026-05-21_my-article.rsvp')
  })
})

describe('articleToRsvp — publishedDate flows into the filename', () => {
  it('uses the article date when present', () => {
    const out = articleToRsvp(
      makeArticle({ title: 'Old Story', publishedDate: '2024-08-09' }),
      FIXED_DATE,
    )
    expect(out.filename).toBe('2024-08-09_old-story.rsvp')
  })

  it('uses today when no publishedDate is on the article', () => {
    const out = articleToRsvp(
      makeArticle({ title: 'Fresh Story', publishedDate: null }),
      FIXED_DATE,
    )
    expect(out.filename).toBe('2026-05-21_fresh-story.rsvp')
  })

  it('preserves a user-edited [YYYY-MM-DD] prefix in @title while keeping a clean filename', () => {
    const out = articleToRsvp(
      makeArticle({
        title: '[2024-08-09] Old Story',
        publishedDate: '2024-08-09',
      }),
      FIXED_DATE,
    )
    // @title carries the user-facing prefix the reader will display.
    expect(out.content).toContain('@title [2024-08-09] Old Story')
    // …but the filename doesn't get a doubled date.
    expect(out.filename).toBe('2024-08-09_old-story.rsvp')
  })
})
