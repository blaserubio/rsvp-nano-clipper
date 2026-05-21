# RSVP Nano Web Clipper

Chromium (Chrome / Edge / Brave / Arc) browser extension that sends web articles
to an [RSVP Nano](https://github.com/ionutdecebal/rsvpnano) reading device with
one click.

The extension extracts the readable content of the current tab, converts it to
the device's `.rsvp` text format, and POSTs it to the device's companion-sync
HTTP API over the local network (default `http://192.168.4.1`). If the device
is unreachable, the article is queued in `chrome.storage.local` and retried on
a `chrome.alarms` schedule, with a "Download as file" fallback.

## Status

Scaffolded (Step 0): Vite + Manifest V3 + TypeScript + React, with a working
toolbar button that opens a popup. No extraction, conversion, or transfer yet
— those land in subsequent build steps.

## Develop

```bash
npm install
npm run dev      # Vite dev server with HMR; writes a working unpacked extension to dist/
```

In a separate window: `npm run build` once for a clean production bundle.

## Load the unpacked extension in Chrome

1. After `npm install`, run `npm run build` (writes the extension to `dist/`).
2. Open `chrome://extensions` (or `edge://extensions`, etc.).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked**.
5. Pick the **`dist/`** folder inside this project.
6. The puzzle-piece RSVP Nano icon appears in the toolbar. Pin it.

## Test against a real device

1. Put the RSVP Nano into **Companion sync** mode (`PWR` menu → Companion sync).
2. Join the `RSVP-Nano-xxxxxx` Wi-Fi network from your computer.
3. (Future step.) Click the extension on any article page → "Send to RSVP Nano".

## Build for distribution

```bash
npm run build
# dist/ contains the extension ready to zip and upload to the Chrome Web Store.
```

## Device upload contract

For reference, the device's companion-sync HTTP API at `http://192.168.4.1`
accepts file uploads at:

```
POST /api/books?name=<urlencoded-filename>&category=<book|article>
Content-Type: multipart/form-data; (FormData with a single field 'file')
```

This contract is mirrored across three reference implementations in the
[rsvpnano](https://github.com/ionutdecebal/rsvpnano) repo:
- `ios/RSVPNanoCompanion/RSVPNanoCompanion/NanoClient.swift` (`uploadBook(...)`)
- `src/sync/CompanionSyncManager.cpp` (the firmware-side HTTP handler)
- The browser companion served by the device itself (uses `FormData` exactly like this extension does)
