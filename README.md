# RSVP Nano Web Clipper

A Chromium browser extension (Chrome / Edge / Brave / Arc) that turns any web
article into a [`.rsvp`](https://github.com/ionutdecebal/rsvpnano) file the
[RSVP Nano](https://github.com/ionutdecebal/rsvpnano) reading device can
read.

Click the extension on an article, the extension extracts the readable
content (filtering out ads, related-stories panels, newsletter prompts, and
other boilerplate), converts it to the device's `.rsvp` format, and saves it
to your Downloads. You then drop the file into the device's
**Companion sync → Books** page from any browser.

> **v1 scope.** This release covers extract → convert → **download**.
> Direct device upload over Wi-Fi, an article queue, a context-menu entry,
> a settings page, and an optional AI-extraction fallback are planned for
> later versions. See [Roadmap](#roadmap) below.

## Features

- **One-click extraction** with Mozilla Readability, on-device only — no
  page content ever leaves your computer.
- **Lazy-load + expander warmup**: scrolls the page and clicks any "Story
  Continues" / "Read more" expanders before extracting so the back half of
  paginated/lazy articles isn't lost.
- **Aggressive junk filtering** at three layers:
  1. DOM-level strip of `<aside>`/`<nav>`/`<iframe>`/ad containers, role-based
     page chrome (banner / navigation / contentinfo / complementary), and
     elements matching word-boundary class/id patterns
     (`advertis…`, `sponsored`, `newsletter`, `related-articles`,
     `comments-section`, `paywall`, `caas-readmore`, …).
  2. A **link-dominated paragraph** heuristic — any `<p>` whose visible text
     is ≥70% inside `<a>` tags is treated as a promo/footer link.
  3. Text-level pattern filter for surviving boilerplate
     (`Advertisement`, `Story continues below…`, `Sign up for our newsletter`,
     `Click here for…`, `Read the latest … from <Site>`, etc.).
- **Multi-section, ad-heavy article handling**: when the page has an
  `<article>` element, walks the entire container in document order and
  collects every surviving block — so subsections after inline ads aren't
  silently dropped. Compares against Readability output and picks whichever
  has more substantive content.
- **Visual verification**: a "Highlight every kept block" button in the
  popup applies a soft green tint to every paragraph/heading the extractor
  kept and auto-scrolls to the last one, so you can visually confirm
  "yes, it caught everything" before downloading.
- **Canonical `.rsvp` output**: format, Unicode handling, and word-wrap
  match the device's own `tools/sd_card_converter/convert_books.py` byte
  for byte. Smart quotes, em-dashes, ellipses, ligatures fold to ASCII;
  extended Latin (`é`, `ñ`, `Łódź`, `ě`, `ő`, …) is preserved because the
  firmware renders it; emojis and other glyphs the firmware can't render
  are stripped.

## How to use it

1. Open any web article in your browser.
2. Click the **RSVP Nano Web Clipper** toolbar icon (or press **`⌘⇧S`** /
   **`Ctrl+Shift+S`** to open the popup with the keyboard).
3. Wait ~1–2 seconds while the extension warms the page up and extracts.
4. Optional: click **"🔍 Highlight every kept block"** to verify what got
   captured. Use **"↑ Jump to start"** / **"↓ Jump to end"** to confirm
   the boundaries.
5. Click **"Download .rsvp"** — the file lands in your Downloads with a
   `YYYY-MM-DD_short-slug.rsvp` filename.
6. On your RSVP Nano: **`PWR` → Companion sync**. Join the
   `RSVP-Nano-xxxxxx` Wi-Fi network. Open `http://192.168.4.1` in any
   browser. Drop the `.rsvp` into the **Books** page.
7. Hold `PWR` on the reader to exit Companion sync, then open the article
   from the **Books** menu and read.

## Install for development (unpacked)

There is no Chrome Web Store listing yet. To use the extension today:

```bash
git clone https://github.com/blaserubio/rsvp-nano-clipper.git
cd rsvp-nano-clipper
npm install
npm run build
```

Then in your browser:

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`,
   `arc://extensions`, etc.).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Pick the `dist/` folder from inside this repo.
5. The toolbar icon appears. Pin it.

To update after pulling a new version: `npm run build`, then click the 🔄
reload icon on the extension's card.

### Develop with HMR

```bash
npm run dev   # Vite dev server; writes a live-updating extension to dist/
```

### Run the tests

```bash
npm test
```

31 unit tests cover the `.rsvp` converter (header, chapters, paragraphs,
word wrap, Unicode handling, accented-Latin preservation, emoji stripping,
slugification, filename format, and an end-to-end realistic-article shape
check).

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the current page's DOM **only when you click the extension**. |
| `scripting` | Inject the content script on-demand into pages that were already open when the extension was installed. |
| Content script on `<all_urls>` | Auto-injects passively on page load so the popup can extract without a chrome.scripting round-trip. It does nothing until it receives a message. |

The extension **does not** request broad `<all_urls>` host permissions,
storage, or context-menu permissions in v1. See [`PRIVACY.md`](PRIVACY.md)
for a full data-handling statement.

## Device upload contract

The extension produces `.rsvp` files for upload via the device's existing
companion-sync web page. The device's HTTP API contract, mirrored from
three reference implementations in the upstream repo:

```
POST  http://192.168.4.1/api/books?name=<urlencoded-filename>&category=<book|article>
Content-Type: multipart/form-data; (FormData with a single field 'file')
```

References:
- `ios/RSVPNanoCompanion/RSVPNanoCompanion/NanoClient.swift` — `uploadBook(…)`
- `src/sync/CompanionSyncManager.cpp` — firmware-side HTTP handler
  (registers `HTTP_POST` for `/api/books`)
- The browser companion served by the device itself uses `new FormData()`
  with a single `'file'` field, identical to what this extension will use
  when direct upload lands.

## Roadmap

These are deferred to keep v1 small and reviewable. They expand the
manifest's permission set when they land:

- **Direct device POST** (adds `host_permissions: ['http://192.168.4.1/*']`)
- **Article queue + periodic retry** when the reader is unreachable
  (adds `storage`, `alarms`)
- **Right-click context menu** "Send to RSVP Nano" on pages, selections,
  and links (adds `contextMenus`)
- **Settings page** for device endpoint, AI-fallback endpoint, and
  auto-send vs preview-first toggles
- **AI extraction fallback** for paywalled / app-shell pages that
  Readability can't crack (adds an optional configurable host permission
  to the user's chosen AI endpoint)

## Security and privacy

- [`SECURITY.md`](SECURITY.md) — security policy and how to report
  vulnerabilities.
- [`PRIVACY.md`](PRIVACY.md) — what data the extension reads and where it
  goes (short answer: nothing leaves your computer in v1).

## License

[MIT](LICENSE). The extension is an independent contributor-side tool;
the RSVP Nano hardware and firmware are separate projects with their own
licenses.
