import { useEffect, useState } from 'react'

import { extractFromActiveTab } from '../lib/extractor'
import type { ExtractedArticle } from '../lib/types'

type ExtractState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; article: ExtractedArticle }
  | { kind: 'error'; message: string }

const PREVIEW_CHARS = 2000

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
      </div>

      <pre style={previewStyle}>
        {article.textContent.slice(0, PREVIEW_CHARS)}
        {article.textContent.length > PREVIEW_CHARS ? '\n…' : ''}
      </pre>

      <button type="button" onClick={onRetry} style={buttonStyle}>
        Re-extract
      </button>
    </div>
  )
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

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
