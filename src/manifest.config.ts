import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from '../package.json' with { type: 'json' }

// Permissions are scoped to what the v1.1 feature set actually uses
// (extract → convert → send-or-download). When the article queue, the
// context menu, and the periodic retry alarm land in later versions, this
// file additionally gains 'contextMenus' and 'alarms' respectively.

export default defineManifest({
  manifest_version: 3,
  name: 'RSVP Nano Web Clipper',
  description:
    'Send web articles to an RSVP Nano reading device with one click.',
  version: packageJson.version,
  action: {
    default_title: 'Send to RSVP Nano',
    default_popup: 'src/popup/popup.html',
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  // The content script is passive: it auto-injects at document_idle on every
  // page so a later popup click can message it without round-tripping
  // chrome.scripting, but it does no work until it receives a message.
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content.ts'],
      run_at: 'document_idle',
    },
  ],
  // activeTab — required to message the current tab on user gesture.
  // scripting — required to inject the content script on-demand into
  //   pages that were already open when the extension was installed.
  // storage   — persists the user's device endpoint (no secrets, no PII).
  permissions: ['activeTab', 'scripting', 'storage'],
  // The default device endpoint (Companion-sync AP) is pre-granted so the
  // common case needs no runtime permission prompt.
  host_permissions: ['http://192.168.4.1/*'],
  // For users who put the reader on a custom IP / hostname, the popup's
  // Settings panel calls chrome.permissions.request() at save time to
  // grant just that origin. The wildcard here is the broadest pattern the
  // user can ever opt into; the runtime request is for the specific origin
  // they typed, not the wildcard.
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  commands: {
    // Reserved command name: pressing the shortcut opens the popup, same as
    // clicking the toolbar icon. We don't need a chrome.commands.onCommand
    // listener for this.
    _execute_action: {
      suggested_key: {
        default: 'Ctrl+Shift+S',
        mac: 'Command+Shift+S',
      },
    },
  },
})
