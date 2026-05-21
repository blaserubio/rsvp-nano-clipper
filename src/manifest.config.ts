import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from '../package.json' with { type: 'json' }

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
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['activeTab', 'contextMenus', 'storage', 'alarms'],
  host_permissions: ['http://192.168.4.1/*'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  commands: {
    'send-to-rsvp-nano': {
      suggested_key: {
        default: 'Ctrl+Shift+S',
        mac: 'Command+Shift+S',
      },
      description: 'Send current page to RSVP Nano',
    },
  },
})
