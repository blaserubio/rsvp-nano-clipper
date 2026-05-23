import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanArticleText,
  clickExpandButtons,
  extractAllArticleParagraphs,
  extractByLargestParagraphContainer,
  isJunkElement,
  removeJunkNodes,
} from '../src/lib/pageHelpers'

function setHtml(html: string): void {
  document.body.innerHTML = html
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isJunkElement', () => {
  it('flags always-junk tags regardless of class', () => {
    setHtml('<nav class="primary"></nav><script></script><iframe></iframe>')
    const nav = document.querySelector('nav')!
    const script = document.querySelector('script')!
    const iframe = document.querySelector('iframe')!
    expect(isJunkElement(nav)).toBe(true)
    expect(isJunkElement(script)).toBe(true)
    expect(isJunkElement(iframe)).toBe(true)
  })

  it('flags <aside> outside an article container but keeps it inside', () => {
    setHtml(`
      <aside id="outside"><p>sidebar</p></aside>
      <article>
        <aside id="inside-plain"><p>pullquote</p></aside>
        <aside id="inside-newsletter" class="newsletter"><p>signup</p></aside>
        <p>real prose</p>
      </article>
    `)
    const article = document.querySelector('article')!
    const outside = document.getElementById('outside')!
    const insidePlain = document.getElementById('inside-plain')!
    const insideNewsletter = document.getElementById('inside-newsletter')!
    expect(isJunkElement(outside, article)).toBe(true)
    expect(isJunkElement(insidePlain, article)).toBe(false)
    expect(isJunkElement(insideNewsletter, article)).toBe(true)
  })

  it('flags elements by junk ARIA role', () => {
    setHtml('<div role="navigation"><p>nope</p></div>')
    expect(isJunkElement(document.querySelector('div')!)).toBe(true)
  })

  it('flags elements by suggestive aria-label', () => {
    setHtml('<div aria-label="Related stories"><p>x</p></div>')
    expect(isJunkElement(document.querySelector('div')!)).toBe(true)
  })

  it('flags elements with data-ad / data-ads attributes', () => {
    setHtml('<div data-ad="leaderboard"></div><div data-ads="rail"></div>')
    const [a, b] = Array.from(document.querySelectorAll('div'))
    expect(isJunkElement(a)).toBe(true)
    expect(isJunkElement(b)).toBe(true)
  })

  it('flags classes only on word boundaries — "address" must not match "ad"', () => {
    setHtml(
      '<div class="address-block"><p>123 Main St</p></div><div class="newsletter-cta"><p>x</p></div>',
    )
    const address = document.querySelector('.address-block')!
    const newsletter = document.querySelector('.newsletter-cta')!
    expect(isJunkElement(address)).toBe(false)
    expect(isJunkElement(newsletter)).toBe(true)
  })

  it('flags link-dominated <p> as junk', () => {
    setHtml(
      '<p id="promo">Read <a href="#">the latest analysis from Yahoo Finance here</a></p>',
    )
    const p = document.getElementById('promo')!
    expect(isJunkElement(p)).toBe(true)
  })

  it('does not flag a <p> with only an inline citation link', () => {
    setHtml(
      '<p id="prose">The committee\'s report (see <a href="#">section 3</a>) concluded that the policy was working as intended for the majority of cases reviewed across the eighteen-month period.</p>',
    )
    expect(isJunkElement(document.getElementById('prose')!)).toBe(false)
  })
})

describe('removeJunkNodes', () => {
  it('strips nav/aside/ads but leaves article prose intact', () => {
    setHtml(`
      <nav><a href="/">Home</a></nav>
      <article>
        <h1>Title</h1>
        <p>First real paragraph with plenty of words to count as prose.</p>
        <div class="newsletter"><p>Sign up</p></div>
        <p>Second real paragraph carrying the rest of the article body.</p>
      </article>
      <aside><p>related stories</p></aside>
      <footer><p>copyright</p></footer>
    `)
    const before = document.querySelectorAll('*').length
    const removed = removeJunkNodes(document)
    expect(removed).toBeGreaterThan(0)
    expect(document.querySelector('nav')).toBeNull()
    expect(document.querySelector('.newsletter')).toBeNull()
    // The article itself and its <p> children survive.
    expect(document.querySelectorAll('article > p').length).toBe(2)
    expect(document.querySelectorAll('*').length).toBeLessThan(before)
  })
})

describe('cleanArticleText', () => {
  it('drops standalone advertisement / sponsor labels', () => {
    const input = [
      'Advertisement',
      'Real opening paragraph of an article that has more than the minimum letter count to count as prose.',
      'Sponsored Content',
      'Real closing paragraph of the article that likewise carries plenty of substantive letters.',
    ].join('\n\n')
    const out = cleanArticleText(input)
    expect(out).not.toMatch(/Advertisement/)
    expect(out).not.toMatch(/Sponsored Content/)
    expect(out).toMatch(/Real opening paragraph/)
    expect(out).toMatch(/Real closing paragraph/)
  })

  it('drops promo CTAs ("Read the latest…", "Click here…")', () => {
    const input = [
      'Click here for in-depth coverage.',
      'Read the latest analysis from Yahoo Finance.',
      'This is the real body of the article with plenty of substantive letters in it to qualify.',
    ].join('\n\n')
    const out = cleanArticleText(input)
    expect(out).not.toMatch(/Click here/)
    expect(out).not.toMatch(/Read the latest/)
    expect(out).toMatch(/real body of the article/)
  })

  it('drops widget metadata lines like "5 Comments" / "8 min read"', () => {
    const input = [
      '5 Comments',
      '8 min read',
      'Updated 3 hours ago',
      'The story itself contains enough alphabetic content to be treated as real prose.',
    ].join('\n\n')
    const out = cleanArticleText(input)
    expect(out).not.toMatch(/Comments/)
    expect(out).not.toMatch(/min read/)
    expect(out).not.toMatch(/Updated/)
    expect(out).toMatch(/real prose/)
  })

  it('drops numeric/ticker-row lines that lack enough letters to be prose', () => {
    const input = [
      'AAPL 192.34 +1.2% MSFT 412.10 -0.3% NVDA 950.00 +2.1%',
      'The real article paragraph contains plenty of letters to register as substantive prose.',
    ].join('\n\n')
    const out = cleanArticleText(input)
    expect(out).not.toMatch(/AAPL/)
    expect(out).toMatch(/real article paragraph/)
  })

  it('preserves paragraph separation with a blank line', () => {
    const input = 'Paragraph one with enough letters.\n\nParagraph two with enough letters.'
    expect(cleanArticleText(input)).toBe(
      'Paragraph one with enough letters.\n\nParagraph two with enough letters.',
    )
  })
})

describe('clickExpandButtons', () => {
  it('clicks expand-style buttons and skips negatives / hidden ones', () => {
    setHtml(`
      <button id="expand">Story continues</button>
      <button id="readmore">Read more</button>
      <button id="subscribe">Subscribe to our newsletter</button>
      <button id="signin">Sign in</button>
      <button id="hidden" style="display:none">Show more</button>
    `)
    let expandClicks = 0
    let subscribeClicks = 0
    document.getElementById('expand')!.addEventListener('click', () => expandClicks++)
    document.getElementById('readmore')!.addEventListener('click', () => expandClicks++)
    document.getElementById('subscribe')!.addEventListener('click', () => subscribeClicks++)
    document.getElementById('signin')!.addEventListener('click', () => subscribeClicks++)

    // happy-dom doesn't lay out, so we stub the visibility signals the code uses.
    for (const btn of document.querySelectorAll('button')) {
      const isHidden = (btn as HTMLElement).id === 'hidden'
      Object.defineProperty(btn, 'offsetParent', {
        configurable: true,
        get: () => (isHidden ? null : document.body),
      })
      ;(btn as HTMLElement).getBoundingClientRect = () =>
        ({
          width: isHidden ? 0 : 80,
          height: isHidden ? 0 : 24,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect
    }

    const clicks = clickExpandButtons()
    expect(clicks).toBe(2)
    expect(expandClicks).toBe(2)
    expect(subscribeClicks).toBe(0)
  })
})

describe('extractByLargestParagraphContainer', () => {
  it('picks the densest paragraph cluster and returns its prose + headings', () => {
    setHtml(`
      <nav>
        <p>Home</p><p>Sports</p><p>Weather</p>
      </nav>
      <main>
        <div id="story">
          <h2>The Section Heading</h2>
          <p>${'Substantial paragraph one with plenty of substantive content in it. '.repeat(3)}</p>
          <p>${'Substantial paragraph two carrying additional article content along too. '.repeat(3)}</p>
          <p>${'Substantial paragraph three rounding out the cluster with more prose still. '.repeat(3)}</p>
        </div>
      </main>
      <footer>
        <p>Subscribe to our newsletter for daily updates.</p>
      </footer>
    `)
    const { text, paragraphCount } = extractByLargestParagraphContainer()
    expect(paragraphCount).toBe(3)
    expect(text).toMatch(/The Section Heading/)
    expect(text).toMatch(/Substantial paragraph one/)
    expect(text).not.toMatch(/Sports/)
    expect(text).not.toMatch(/Subscribe/)
  })
})

describe('extractAllArticleParagraphs', () => {
  it('extracts prose from a single <article> in document order', () => {
    setHtml(`
      <nav><p>Home</p></nav>
      <article>
        <h1>The Headline</h1>
        <p>Opening paragraph with enough substantive content to clear the threshold.</p>
        <div class="newsletter-signup"><p>ad copy here that should never appear</p></div>
        <p>Second paragraph continues the article body with more substantive content.</p>
        <blockquote>A pullquote with substantive content from the source we are citing.</blockquote>
        <p>Closing paragraph wraps up the article body with one final substantive thought.</p>
      </article>
    `)
    const { text, paragraphCount } = extractAllArticleParagraphs()
    expect(paragraphCount).toBe(3)
    expect(text).toMatch(/The Headline/)
    expect(text).toMatch(/Opening paragraph/)
    expect(text).toMatch(/A pullquote/)
    expect(text).toMatch(/Closing paragraph/)
    expect(text).not.toMatch(/ad copy/)
    // Order: headline → opening → second → blockquote → closing
    const idxHead = text.indexOf('The Headline')
    const idxOpen = text.indexOf('Opening paragraph')
    const idxClose = text.indexOf('Closing paragraph')
    expect(idxHead).toBeLessThan(idxOpen)
    expect(idxOpen).toBeLessThan(idxClose)
  })

  it('de-duplicates paragraphs that appear in nested article containers', () => {
    setHtml(`
      <article>
        <p>The repeated paragraph appears twice and should only be kept once in the output.</p>
        <article>
          <p>The repeated paragraph appears twice and should only be kept once in the output.</p>
          <p>A second unique paragraph providing additional article content beyond the duplicate.</p>
        </article>
      </article>
    `)
    const { text } = extractAllArticleParagraphs()
    const occurrences = text.split('repeated paragraph').length - 1
    expect(occurrences).toBe(1)
    expect(text).toMatch(/second unique paragraph/)
  })

  it('falls back to the largest paragraph container when no <article> exists', () => {
    setHtml(`
      <main>
        <div>
          <p>${'Standalone story paragraph one without an article wrapper present. '.repeat(3)}</p>
          <p>${'Standalone story paragraph two without an article wrapper present. '.repeat(3)}</p>
        </div>
      </main>
    `)
    const { text, paragraphCount } = extractAllArticleParagraphs()
    expect(paragraphCount).toBe(2)
    expect(text).toMatch(/Standalone story paragraph one/)
    expect(text).toMatch(/Standalone story paragraph two/)
  })

  it('picks the dominant <article> when the page contains related-story cards', () => {
    const main = `<p>${'The main article body paragraph carries substantive content across multiple sentences and has plenty of length to dominate the page score. '.repeat(8)}</p>`
    const card = (n: number) =>
      `<article class="related-card"><h3>Related ${n}</h3><p>${'Tiny related card summary line. '.repeat(2)}</p></article>`
    setHtml(`
      <main>
        <article id="main">
          <h1>Headline</h1>
          ${main}
        </article>
        ${card(1)}
        ${card(2)}
        ${card(3)}
      </main>
    `)
    const { text } = extractAllArticleParagraphs()
    expect(text).toMatch(/main article body paragraph/)
    expect(text).not.toMatch(/Tiny related card summary/)
    expect(text).not.toMatch(/Related 1/)
  })
})
