import { useEffect, useState } from 'react'

// Hello-world popup. Confirms the build pipeline works end-to-end:
//   - React renders inside the MV3 popup,
//   - chrome.* APIs are reachable from the popup process,
//   - clicks update state.
// Real UI lands in Step 1.
export function App() {
  const [tabTitle, setTabTitle] = useState<string>('(reading current tab…)')
  const [clicks, setClicks] = useState<number>(0)

  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setTabTitle(tab?.title ?? '(no title)'))
      .catch(() => setTabTitle('(could not read tab)'))
  }, [])

  return (
    <div
      style={{
        padding: 16,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        minWidth: 320,
        color: '#222',
      }}
    >
      <h1 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>
        RSVP Nano Web Clipper
      </h1>
      <p style={{ fontSize: 12, color: '#666', margin: '0 0 14px' }}>
        Scaffolded · not wired to the device yet
      </p>

      <div
        style={{
          fontSize: 12,
          margin: '0 0 14px',
          padding: '8px 10px',
          background: '#fff',
          border: '1px solid #eee',
          borderRadius: 6,
        }}
      >
        <div style={{ color: '#888', marginBottom: 4 }}>Current tab</div>
        <div style={{ wordBreak: 'break-word' }}>{tabTitle}</div>
      </div>

      <button
        type="button"
        onClick={() => setClicks((c) => c + 1)}
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: 13,
          border: '1px solid #c8c8c8',
          borderRadius: 6,
          background: '#f5f5f5',
          cursor: 'pointer',
        }}
      >
        Hello world (clicks: {clicks})
      </button>
    </div>
  )
}
