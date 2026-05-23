import { useEffect, useState } from 'react'

import { fetchDeviceInfo, uploadArticle } from '../lib/deviceClient'
import {
  extractFromActiveTab,
  highlightInActiveTab,
  scrollInActiveTab,
  unhighlightInActiveTab,
} from '../lib/extractor'
import { articleToRsvp, formatTitleWithDate } from '../lib/rsvpFormat'
import {
  DEFAULT_ENDPOINT,
  endpointOriginPattern,
  isDefaultEndpoint,
  loadSettings,
  normalizeEndpoint,
  saveSettings,
} from '../lib/settings'
import type { DeviceInfo, ExtractedArticle, Settings } from '../lib/types'

type ExtractState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; article: ExtractedArticle }
  | { kind: 'error'; message: string }

type ReaderStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'online'; info: DeviceInfo }
  | { kind: 'offline'; reason: string }

const PREVIEW_CHARS = 4000

export function App() {
  const [extract, setExtract] = useState<ExtractState>({ kind: 'idle' })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>({ kind: 'idle' })

  async function runExtract(): Promise<void> {
    setExtract({ kind: 'loading' })
    try {
      const article = await extractFromActiveTab()
      setExtract({ kind: 'ok', article })
    } catch (e) {
      setExtract({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Unknown error.',
      })
    }
  }

  // Quick liveness ping on the configured endpoint. Updates the badge in the
  // Settings header so the user sees Wi-Fi state BEFORE clicking Send.
  async function checkReader(endpoint: string): Promise<void> {
    setReaderStatus({ kind: 'checking' })
    const res = await fetchDeviceInfo(endpoint)
    if (res.kind === 'ok') {
      setReaderStatus({ kind: 'online', info: res.info })
    } else if (res.kind === 'unreachable' || res.kind === 'timeout') {
      setReaderStatus({
        kind: 'offline',
        reason:
          res.kind === 'timeout'
            ? "Reader didn't respond. Are you on its Wi-Fi (RSVP-Nano-xxxxxx)?"
            : 'Switch to the reader\'s Wi-Fi (RSVP-Nano-xxxxxx) and re-open this popup.',
      })
    } else {
      setReaderStatus({ kind: 'offline', reason: res.message })
    }
  }

  useEffect(() => {
    void runExtract()
    void loadSettings().then((s) => {
      setSettings(s)
      void checkReader(s.endpoint)
    })
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
          Extract · convert · send to reader
        </div>
      </header>

      <SettingsPanel
        settings={settings}
        status={readerStatus}
        onChange={(next) => {
          setSettings(next)
          void checkReader(next.endpoint)
        }}
        onRecheck={() => {
          if (settings) void checkReader(settings.endpoint)
        }}
      />

      {extract.kind === 'loading' && (
        <div style={statusBoxStyle}>Extracting article…</div>
      )}

      {extract.kind === 'error' && (
        <ErrorBlock message={extract.message} onRetry={runExtract} />
      )}

      {extract.kind === 'ok' && (
        <ArticleBlock
          article={extract.article}
          endpoint={settings?.endpoint ?? DEFAULT_ENDPOINT}
          onRetry={runExtract}
          onSendComplete={() => {
            if (settings) void checkReader(settings.endpoint)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings panel — collapsible; manages the device endpoint setting.
// ---------------------------------------------------------------------------

function SettingsPanel({
  settings,
  status,
  onChange,
  onRecheck,
}: {
  settings: Settings | null
  status: ReaderStatus
  onChange: (next: Settings) => void
  onRecheck: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'ok'; info: DeviceInfo }
    | { kind: 'err'; msg: string }
  >({ kind: 'idle' })

  // Sync draft when settings load or change externally.
  useEffect(() => {
    if (settings) setDraft(settings.endpoint)
  }, [settings])

  if (!settings) {
    // Settings load is fast; render a tiny placeholder rather than nothing.
    return <div style={{ ...settingsRowStyle, color: '#888' }}>Loading settings…</div>
  }

  const currentEndpoint = settings.endpoint
  const isCustom = !isDefaultEndpoint(currentEndpoint)

  async function handleSave(): Promise<void> {
    setError(null)
    let normalised: string
    try {
      normalised = normalizeEndpoint(draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid URL.')
      return
    }

    // For non-default endpoints, request the host permission first. Chrome
    // shows the user a prompt; we only persist if they grant it.
    if (!isDefaultEndpoint(normalised)) {
      let granted = false
      try {
        granted = await chrome.permissions.request({
          origins: [endpointOriginPattern(normalised)],
        })
      } catch (e) {
        setError(
          `Could not request permission for ${normalised}: ${e instanceof Error ? e.message : 'unknown error'}`,
        )
        return
      }
      if (!granted) {
        setError(
          `Permission to reach ${normalised} was not granted. The default endpoint will keep working.`,
        )
        return
      }
    }

    const next: Settings = { endpoint: normalised }
    await saveSettings(next)
    onChange(next)
    setDraft(normalised)
    setTestResult({ kind: 'idle' })
  }

  async function handleReset(): Promise<void> {
    setError(null)
    const next: Settings = { endpoint: DEFAULT_ENDPOINT }
    await saveSettings(next)
    onChange(next)
    setDraft(DEFAULT_ENDPOINT)
    setTestResult({ kind: 'idle' })
  }

  async function handleTest(): Promise<void> {
    setTestResult({ kind: 'busy' })
    let normalised: string
    try {
      normalised = normalizeEndpoint(draft)
    } catch (e) {
      setTestResult({
        kind: 'err',
        msg: e instanceof Error ? e.message : 'Invalid URL.',
      })
      return
    }

    // If the user hasn't yet saved this endpoint and it's non-default, fetch
    // will fail with a permission error. Request first so Test is useful.
    if (!isDefaultEndpoint(normalised)) {
      const hasPermission = await chrome.permissions.contains({
        origins: [endpointOriginPattern(normalised)],
      })
      if (!hasPermission) {
        const granted = await chrome.permissions.request({
          origins: [endpointOriginPattern(normalised)],
        })
        if (!granted) {
          setTestResult({
            kind: 'err',
            msg: `Permission required to reach ${normalised}.`,
          })
          return
        }
      }
    }

    const res = await fetchDeviceInfo(normalised)
    if (res.kind === 'ok') {
      setTestResult({ kind: 'ok', info: res.info })
    } else if (res.kind === 'unreachable') {
      setTestResult({
        kind: 'err',
        msg: 'Reader unreachable. Is Companion sync on and are you joined to its Wi-Fi?',
      })
    } else if (res.kind === 'timeout') {
      setTestResult({ kind: 'err', msg: 'Reader did not respond in time.' })
    } else {
      setTestResult({ kind: 'err', msg: res.message })
    }
  }

  return (
    <div style={settingsWrapperStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={settingsHeaderStyle}
        title="Configure the device endpoint"
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚙️ Reader</span>
          <ReaderStatusBadge status={status} />
        </span>
        <span style={{ color: '#888', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>
          {currentEndpoint}
          <span style={{ marginLeft: 6, color: '#aaa' }}>{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {!open && status.kind === 'offline' && (
        <div
          style={{
            padding: '6px 12px',
            background: '#fff8e6',
            borderBottom: '1px solid #eee',
            fontSize: 11,
            color: '#8a5a00',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>⚠ {status.reason}</span>
          <button
            type="button"
            onClick={onRecheck}
            style={{
              padding: '3px 8px',
              fontSize: 10,
              border: '1px solid #d8c590',
              background: '#fff',
              borderRadius: 4,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Re-check
          </button>
        </div>
      )}

      {open && (
        <div style={{ padding: '10px 12px' }}>
          <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>
            Device URL
          </label>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={DEFAULT_ENDPOINT}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={inputStyle}
          />

          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              onClick={handleSave}
              style={{ ...buttonStyle, flex: 1 }}
              disabled={draft.trim() === currentEndpoint}
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleTest}
              style={{ ...buttonStyle, flex: 1 }}
              disabled={testResult.kind === 'busy'}
            >
              {testResult.kind === 'busy' ? 'Testing…' : 'Test connection'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              style={{ ...buttonStyle, flex: 1 }}
              disabled={!isCustom && draft.trim() === DEFAULT_ENDPOINT}
            >
              Reset
            </button>
          </div>

          {error && (
            <div style={{ ...miniNoticeStyle, color: '#a02020' }}>{error}</div>
          )}
          {testResult.kind === 'ok' && (
            <div style={{ ...miniNoticeStyle, color: '#1e5e1e' }}>
              ✓ Connected to <strong>{testResult.info.name}</strong>
              {testResult.info.version ? ` · ${testResult.info.version}` : ''}
            </div>
          )}
          {testResult.kind === 'err' && (
            <div style={{ ...miniNoticeStyle, color: '#a02020' }}>{testResult.msg}</div>
          )}

          <div style={{ fontSize: 10, color: '#999', marginTop: 6 }}>
            Default is <code>{DEFAULT_ENDPOINT}</code> — the IP the reader hosts in
            Companion sync mode. Custom endpoints prompt for permission on Save.
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reader-status badge — a small pill in the Settings header that surfaces the
// result of the popup-on-open /api/info ping. Lets the user see Wi-Fi state
// BEFORE clicking Send rather than discovering it ~8 s later.
// ---------------------------------------------------------------------------

function ReaderStatusBadge({ status }: { status: ReaderStatus }): React.ReactElement {
  const base: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 10,
    whiteSpace: 'nowrap',
  }
  if (status.kind === 'checking') {
    return (
      <span style={{ ...base, background: '#eef0f3', color: '#666', border: '1px solid #dde0e4' }}>
        Checking…
      </span>
    )
  }
  if (status.kind === 'online') {
    return (
      <span
        style={{ ...base, background: '#e8f7ec', color: '#1e6a30', border: '1px solid #cfe8d4' }}
        title={`Reader reachable at ${status.info.name}`}
      >
        ✓ {status.info.name}
      </span>
    )
  }
  if (status.kind === 'offline') {
    return (
      <span
        style={{ ...base, background: '#fff3d6', color: '#8a5a00', border: '1px solid #efd99a' }}
        title={status.reason}
      >
        ⚠ Offline
      </span>
    )
  }
  return <span />
}

// ---------------------------------------------------------------------------
// Article block — extraction meta, Send (primary), highlight, preview,
// Download (secondary), Re-extract.
// ---------------------------------------------------------------------------

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; deviceName?: string; savedAs: string }
  | { kind: 'failed'; message: string; canFallback: true }

function ArticleBlock({
  article,
  endpoint,
  onRetry,
  onSendComplete,
}: {
  article: ExtractedArticle
  endpoint: string
  onRetry: () => void
  onSendComplete?: () => void
}): React.ReactElement {
  const words = countWords(article.textContent)
  const [send, setSend] = useState<SendState>({ kind: 'idle' })
  const [downloadMsg, setDownloadMsg] = useState<
    { tone: 'ok' | 'err'; text: string } | null
  >(null)
  const [highlight, setHighlight] = useState<
    | { kind: 'off' }
    | { kind: 'on'; count: number }
    | { kind: 'busy' }
    | { kind: 'err'; msg: string }
  >({ kind: 'off' })

  // Editable title — pre-filled with the article's title (with a
  // `[YYYY-MM-DD]` prefix when the publication date was extracted) so the
  // user sees what will land on the reader and can tweak before sending.
  const [editedTitle, setEditedTitle] = useState<string>(() =>
    formatTitleWithDate(article.title, article.publishedDate),
  )

  function articleForConversion(): ExtractedArticle {
    const trimmed = editedTitle.trim()
    return {
      ...article,
      title: trimmed.length > 0 ? trimmed : article.title,
    }
  }

  function performDownload(): { ok: boolean; filename?: string; error?: string } {
    try {
      const rsvp = articleToRsvp(articleForConversion())
      triggerDownload(rsvp.filename, rsvp.content)
      setDownloadMsg({
        tone: 'ok',
        text: `Saved ${rsvp.filename} · ${rsvp.wordCount.toLocaleString()} words, ${rsvp.chapterCount} chapter${rsvp.chapterCount === 1 ? '' : 's'}`,
      })
      return { ok: true, filename: rsvp.filename }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Download failed.'
      setDownloadMsg({ tone: 'err', text: error })
      return { ok: false, error }
    }
  }

  async function handleSend(): Promise<void> {
    setSend({ kind: 'sending' })
    setDownloadMsg(null)

    let rsvp
    try {
      rsvp = articleToRsvp(articleForConversion())
    } catch (e) {
      setSend({
        kind: 'failed',
        canFallback: true,
        message: e instanceof Error ? e.message : 'Could not convert article.',
      })
      return
    }

    // Best to fetch a quick device-name for the success message. Fire in
    // parallel with the upload — if it fails, we just don't show a name.
    const infoPromise = fetchDeviceInfo(endpoint).catch(() => null)

    const result = await uploadArticle(
      { filename: rsvp.filename, content: rsvp.content },
      endpoint,
    )

    if (result.kind === 'ok') {
      const infoRes = await infoPromise
      const deviceName =
        infoRes && infoRes.kind === 'ok' ? infoRes.info.name : undefined
      setSend({ kind: 'sent', deviceName, savedAs: result.filename })
      onSendComplete?.()
      return
    }

    let message: string
    if (result.kind === 'unreachable') {
      // The #1 cause: user isn't joined to the reader's Wi-Fi network. Lead
      // with that. The endpoint URL is in the Settings header already.
      message =
        `Reader not reachable. Switch your computer's Wi-Fi to RSVP-Nano-xxxxxx ` +
        `(the network the reader broadcasts in Companion sync mode) and click Retry send.`
    } else if (result.kind === 'timeout') {
      // Slow hang usually means our IP is being answered by an unrelated host
      // on the user's home network (their home router at 192.168.4.1 etc.).
      message =
        `Reader didn't respond in ${Math.round(result.timeoutMs / 1000)}s. ` +
        `You're probably on the wrong Wi-Fi — switch to RSVP-Nano-xxxxxx and click Retry send.`
    } else if (result.kind === 'rejected') {
      message = `Reader rejected the upload (HTTP ${result.status}): ${result.message}`
    } else {
      message = `Reader error (HTTP ${result.status}): ${result.message}`
    }
    setSend({ kind: 'failed', canFallback: true, message })
  }

  function handleDownloadFallback(): void {
    performDownload()
    setSend({ kind: 'idle' })
  }

  function handleDownloadDirect(): void {
    performDownload()
  }

  async function handleShowOnPage(): Promise<void> {
    setHighlight({ kind: 'busy' })
    try {
      const count = await highlightInActiveTab(article.textContent)
      setHighlight({ kind: 'on', count })
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
      <div style={titleFieldStyle}>
        <label
          htmlFor="rsvpnano-title"
          style={{
            display: 'block',
            fontSize: 10,
            fontWeight: 600,
            color: '#666',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Title on reader
        </label>
        <input
          id="rsvpnano-title"
          type="text"
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.35,
            color: '#222',
            border: '1px solid #d0d4d9',
            borderRadius: 4,
            background: '#fff',
            boxSizing: 'border-box',
          }}
        />
        {article.publishedDate && (
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
            Article date: {article.publishedDate} · prefix added automatically;
            edit freely.
          </div>
        )}
        {!article.publishedDate && (
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
            No publication date on the page — add one manually if you want it
            to show on the reader.
          </div>
        )}
      </div>
      <div style={metaCardStyle}>
        {article.byline && (
          <div style={{ fontSize: 11, color: '#666' }}>
            {article.byline}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#888', marginTop: article.byline ? 6 : 0 }}>
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

      {/* SEND — primary action */}
      <div style={{ marginBottom: 10 }}>
        {send.kind === 'idle' && (
          <button type="button" onClick={handleSend} style={primaryButtonStyle}>
            📡 Send to RSVP Nano
          </button>
        )}
        {send.kind === 'sending' && (
          <button type="button" disabled style={primaryButtonStyle}>
            Sending…
          </button>
        )}
        {send.kind === 'sent' && (
          <div>
            <button type="button" disabled style={successButtonStyle}>
              ✓ Sent
              {send.deviceName ? ` to ${send.deviceName}` : ''}
            </button>
            <div style={{ ...miniNoticeStyle, color: '#1e5e1e', marginTop: 4 }}>
              Saved as <code>{send.savedAs}</code> in <code>/books/articles/</code>.
              On the reader, exit Companion sync and open <strong>Articles</strong>.
            </div>
          </div>
        )}
        {send.kind === 'failed' && (
          <div>
            <div
              style={{
                ...statusBoxStyle,
                background: '#fff5f5',
                borderColor: '#f0c8c8',
                color: '#a02020',
                marginBottom: 8,
              }}
            >
              {send.message}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={handleSend}
                style={{ ...buttonStyle, flex: 1 }}
              >
                Retry send
              </button>
              <button
                type="button"
                onClick={handleDownloadFallback}
                style={{ ...primaryButtonStyle, flex: 1 }}
              >
                Download .rsvp instead
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Highlight controls */}
      <div style={{ marginBottom: 8 }}>
        {highlight.kind === 'off' && (
          <button
            type="button"
            onClick={handleShowOnPage}
            style={buttonStyle}
            title="Highlight every paragraph and heading the extractor kept"
          >
            🔍 Highlight every kept block
          </button>
        )}
        {highlight.kind === 'busy' && (
          <button type="button" disabled style={buttonStyle}>
            Highlighting…
          </button>
        )}
        {highlight.kind === 'on' && (
          <div>
            <div style={{ fontSize: 11, color: '#1e5e1e', marginBottom: 6 }}>
              ✓ Highlighted all {highlight.count}{' '}
              {highlight.count === 1 ? 'kept block' : 'kept blocks'} on the page
            </div>
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
                title="Scroll to the first highlighted block"
              >
                ↑ Jump to start
              </button>
              <button
                type="button"
                onClick={() => handleScroll('last')}
                style={{ ...buttonStyle, flex: 1 }}
                title="Scroll to the last highlighted block"
              >
                ↓ Jump to end
              </button>
              <button
                type="button"
                onClick={handleHideOnPage}
                style={{ ...buttonStyle, flex: 1 }}
              >
                Hide
              </button>
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

      {/* Download — secondary action (always available, independent of Send) */}
      <button type="button" onClick={handleDownloadDirect} style={buttonStyle}>
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
        </div>
      )}

      <button
        type="button"
        onClick={onRetry}
        style={{ ...buttonStyle, marginTop: 8 }}
      >
        Re-extract
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const statusBoxStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '10px 12px',
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 6,
  marginBottom: 10,
}

const titleFieldStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#f5f9ff',
  border: '1px solid #cfdef5',
  borderRadius: 6,
  marginBottom: 8,
}

const metaCardStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 6,
  marginBottom: 10,
}

const previewStyle: React.CSSProperties = {
  maxHeight: 220,
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

const successButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#1e7e34',
  borderColor: '#176a2c',
  color: 'white',
  fontWeight: 600,
  cursor: 'default',
}

const settingsWrapperStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 6,
  marginBottom: 12,
  overflow: 'hidden',
}

const settingsHeaderStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 500,
  background: '#fafafa',
  border: 'none',
  borderBottom: '1px solid #eee',
  cursor: 'pointer',
  textAlign: 'left',
}

const settingsRowStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  background: '#fafafa',
  border: '1px solid #eee',
  borderRadius: 6,
  marginBottom: 12,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #c8c8c8',
  borderRadius: 4,
  boxSizing: 'border-box',
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
}

const miniNoticeStyle: React.CSSProperties = {
  fontSize: 11,
  marginTop: 6,
  lineHeight: 1.4,
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
