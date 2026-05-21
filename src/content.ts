// Content script stub — runs at document_idle on every page the user grants access to.
// Real article extraction (Readability) lands in Step 1.

console.log('[RSVP Nano Clipper] content script loaded on', location.href)

// Future: listen for messages from the popup/service worker requesting extraction.
//   chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => { ... })

export {}
