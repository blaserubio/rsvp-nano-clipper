import { describe, expect, it } from 'vitest'

import { articleToRsvp, buildFilename, normalizeText, slugify } from '../src/lib/rsvpFormat'
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
