// MV3 service worker for RSVP Nano Web Clipper.
//
// V1 has no background work: the popup drives extraction and download
// directly, and the keyboard shortcut (`_execute_action`) is wired by
// Chrome itself to open the popup. This file exists because MV3 requires
// a registered service worker and gives future on-install tasks and a
// future queue/alarm handler a home.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[RSVP Nano Clipper] installed')
  } else if (details.reason === 'update') {
    console.log(
      '[RSVP Nano Clipper] updated to',
      chrome.runtime.getManifest().version,
    )
  }
})
