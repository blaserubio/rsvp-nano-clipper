// Service worker for RSVP Nano Web Clipper.
// MV3 service workers are short-lived: keep top-level work minimal and idempotent.

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[RSVP Nano Clipper] installed:', details.reason)
})

// The toolbar action has a default_popup, so this only fires if the popup is suppressed
// (for example, when the user invokes the action via the keyboard command without a popup).
chrome.action.onClicked.addListener(() => {
  // Hello-world: nothing wired up yet. Real send-flow lands in later steps.
})

console.log('[RSVP Nano Clipper] background service worker started')
