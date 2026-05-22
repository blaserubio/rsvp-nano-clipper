import { useEffect, useState } from 'react'

import {
  extractFromActiveTab,
  highlightInActiveTab,
  scrollInActiveTab,
  unhighlightInActiveTab,
} from '../lib/extractor'
import { articleToRsvp } from '../lib/rsvpFormat'
import type { ExtractedArticle } from '../lib/types'

type ExtractState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; article: ExtractedArticle }
  | { kind: 'error'; message: string }

const PREVIEW_CHARS = 4000

export function App() {
  const [state, setState] = useState<ExtractState>({ kind: 'idle' })

  async function runExtract(): Promise<void> {
    setState({ kind: 'loading' })
    try {
      const article = await extractFromActiveTab()
      setState({ kind: 'ok', article })
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Unknown error.',
      })
    }
  }

  // Auto-extract when the popup opens — saves a click.
  useEffect(() => {
    void runExtract()
  }, [])

  return (
    <div
      style={{
        padding: 14,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        minWidth: 380,
        maxWidth: 440,
        color: '#222',
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>
          RSVP Nano Web Clipper
        </h1>
        <div style={{ fontSize: 11, color: '#888' }}>
          Step 1 · extraction preview · no transfer yet
        </div>
      </header>

      {state.kind === 'loading' && (
        <div style={statusBoxStyle}>Extracting article…</div>
      )}

      {state.kind === 'error' && (
        <ErrorBlock message={state.message} onRetry={runExtract} />
      )}

      {state.kind === 'ok' && (
        <ArticleBlock article={state.article} onRetry={runExtract} />
      )}
    </div>
  )
}

function ArticleBlock({
  article,
  onRetry,
}: {
  article: ExtractedArticle
  onRetry: () => void
}): React.ReactElement {
  const words = countWords(article.textContent)
  const [downloadMsg, setDownloadMsg] = useState<
    { tone: 'ok' | 'err'; text: string } | null
  >(null)
  const [highlight, setHighlight] = useState<
    { kind: 'off' } | { kind: 'on'; count: number } | { kind: 'busy' } | { kind: 'err'; msg: string }
  >({ kind: 'off' })

  function handleDownload(): void {
    try {
      const rsvp = articleToRsvp(article)
      triggerDownload(rsvp.filename, rsvp.content)
      setDownloadMsg({
        tone: 'ok',
        text: `Saved ${rsvp.filename} · ${rsvp.wordCount.toLocaleString()} words, ${rsvp.chapterCount} chapter${rsvp.chapterCount === 1 ? '' : 's'}`,
      })
    } catch (e) {
      setDownloadMsg({
        tone: 'err',
        text: e instanceof Error ? e.message : 'Download failed.',
      })
    }
  }

  async function handleShowOnPage(): Promise<void> {
    setHighlight({ kind: 'busy' })
    try {
      const count = await highlightInActiveTab(article.textContent)
      setHighlight({ kind: 'on', count })
      // Auto-jump to the LAST extracted element so the user can see the
      // boundary immediately — that's the whole point of this feature.
      try {
        await scrollInActiveTab('last')
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      setHighlight({
        kind: 'err',
        msg: e instanceof Error ? e.message : 'Highlight failed.',
      })
    }
  }

  async function handleHideOnPage(): Promise<void> {
    try {
      await unhighlightInActiveTab()
    } catch {
      /* best-effort cleanup */
    }
    setHighlight({ kind: 'off' })
  }

  async function handleScroll(which: 'first' | 'last'): Promise<void> {
    try {
      await scrollInActiveTab(which)
    } catch {
      /* non-fatal */
    }
  }

  return (
    <div>
      <div style={metaCardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
          {article.title}
        </div>
        {article.byline && (
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            {article.byline}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
          {words.toLocaleString()} words · {article.length.toLocaleString()}{' '}
          chars
          {article.siteName ? ` · ${article.siteName}` : ''}
          {' · '}
          <span
            style={{ color: article.readerable ? '#0a7c2a' : '#a05500' }}
            title="Readability's own heuristic for whether this page looks like an article."
          >
            {article.readerable ? 'reader-friendly ✓' : 'not reader-friendly ⚠'}
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
          method:{' '}
          <strong style={{ color: '#555' }}>{article.method}</strong>
          {' · '}
          readability {article.diagnostics.readabilityWords.toLocaleString()} w
          {' / '}
          fallback {article.diagnostics.fallbackWords.toLocaleString()} w
          {article.diagnostics.expandersClicked > 0 &&
            ` · expanded ${article.diagnostics.expandersClicked}`}
          {article.diagnostics.junkRemoved > 0 &&
            ` · stripped ${article.diagnostics.junkRemoved} junk`}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        {highlight.kind === 'off' && (
          <button
            type="button"
            onClick={handleShowOnPage}
            style={buttonStyle}
            title="Highlight every kept paragraph/heading on the page and jump to the last one"
          >
            🔍 Show extracted on page
          </button>
        )}
        {highlight.kind === 'busy' && (
          <button type="button" disabled style={buttonStyle}>
            Highlighting…
          </button>
        )}
        {highlight.kind === 'on' && (
          <div>
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginBottom: 6,
              }}
            >
              <button
                type="button"
                onClick={() => handleScroll('first')}
                style={{ ...buttonStyle, flex: 1 }}
              >
                ↑ First
              </button>
              <button
                type="button"
                onClick={() => handleScroll('last')}
                style={{ ...buttonStyle, flex: 1 }}
              >
                ↓ Last
              </button>
              <button
                type="button"
                onClick={handleHideOnPage}
                style={{ ...buttonStyle, flex: 1 }}
              >
                Hide
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#1e5e1e' }}>
              Highlighted {highlight.count}{' '}
              {highlight.count === 1 ? 'block' : 'blocks'} on the page · jumped
              to the last one
            </div>
          </div>
        )}
        {highlight.kind === 'err' && (
          <div>
            <button type="button" onClick={handleShowOnPage} style={buttonStyle}>
              🔍 Show extracted on page
            </button>
            <div style={{ fontSize: 11, color: '#a02020', marginTop: 4 }}>
              {highlight.msg}
            </div>
          </div>
        )}
      </div>

      <pre style={previewStyle}>
        {article.textContent.slice(0, PREVIEW_CHARS)}
        {article.textContent.length > PREVIEW_CHARS ? '\n…' : ''}
      </pre>

      <button type="button" onClick={handleDownload} style={primaryButtonStyle}>
        Download .rsvp
      </button>

      {downloadMsg && (
        <div
          style={{
            ...statusBoxStyle,
            marginTop: 8,
            marginBottom: 8,
            background: downloadMsg.tone === 'ok' ? '#f0faf0' : '#fff5f5',
            borderColor: downloadMsg.tone === 'ok' ? '#cce6cc' : '#f0c8c8',
            color: downloadMsg.tone === 'ok' ? '#1e5e1e' : '#a02020',
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {downloadMsg.text}
          {downloadMsg.tone === 'ok' && (
            <div style={{ marginTop: 4, color: '#666' }}>
              Open Companion sync on your reader, then drop this file into the Books page.
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={onRetry} style={buttonStyle}>
        Re-extract
      </button>
    </div>
  )
}

function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ErrorBlock({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}): React.ReactElement {
  return (
    <div>
      <div
        style={{
          ...statusBoxStyle,
          background: '#fff5f5',
          borderColor: '#f0c8c8',
          color: '#a02020',
        }}
      >
        {message}
      </div>
      <button type="button" onClick={onRetry} style={buttonStyle}>
        Try again
      </button>
    </div>
  )
}

const statusBoxStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '10px 12px',
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 6,
  marginBottom: 10,
}

const metaCardStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 6,
  marginBottom: 8,
}

const previewStyle: React.CSSProperties = {
  maxHeight: 260,
  overflow: 'auto',
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  margin: '0 0 10px',
  padding: '10px 12px',
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 6,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
}

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #c8c8c8',
  borderRadius: 6,
  background: '#f5f5f5',
  cursor: 'pointer',
}

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#1f6feb',
  borderColor: '#1158c7',
  color: 'white',
  fontWeight: 600,
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
