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

> **v1.1 scope.** Extract → convert → **send to the reader** over its
> Companion-sync Wi-Fi network. Download is still available as a one-click
> fallback when the reader is offline. An article queue with periodic
> retry, a right-click context menu, and an optional AI-extraction
> fallback are planned for later versions. See [Roadmap](#roadmap) below.

## Features

- **One-click Send** straight to the reader over its Companion-sync Wi-Fi
  network — no Download/upload dance. Falls back to Download if the
  reader is unreachable, with the failure path one click away.
- **Configurable device endpoint** in a collapsible Settings panel inside
  the popup. Default is `http://192.168.4.1` (the IP the reader hosts in
  Companion sync mode). Custom endpoints are supported and prompt for
  host permission on save.
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

1. On the reader: **`PWR` → `Companion sync`**. Join its Wi-Fi network
   (`RSVP-Nano-xxxxxx`) from your computer.
2. Open any web article in your browser.
3. Click the **RSVP Nano Web Clipper** toolbar icon (or press **`⌘⇧S`** /
   **`Ctrl+Shift+S`** to open the popup with the keyboard).
4. Wait ~1–2 seconds while the extension warms the page up and extracts.
5. Optional: click **"🔍 Highlight every kept block"** to verify what got
   captured. Use **"↑ Jump to start"** / **"↓ Jump to end"** to confirm
   the boundaries.
6. Click **"📡 Send to RSVP Nano"** — popup confirms `"✓ Sent to <reader
   name>"` once the upload succeeds.
7. Hold `PWR` on the reader to exit Companion sync, then open the
   article from the **Articles** menu and read.

If the reader is unreachable (e.g. Companion sync is off, or your
computer isn't joined to its Wi-Fi), the popup shows the error and a
one-click **"Download .rsvp instead"** button that saves the file to
your Downloads. From there, drop it into the reader's
`http://192.168.4.1` **Books** page the next time you're connected.

### Using a custom device endpoint

If you've configured a static IP / mDNS name for the reader, open the
**⚙️ Reader endpoint** panel at the top of the popup, type the URL, and
click **Save**. Chrome will prompt to grant permission for that origin
(once). Then **Send** posts there instead of the default.

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

59 unit tests cover the `.rsvp` converter (header, chapters, paragraphs,
word wrap, Unicode handling, accented-Latin preservation, emoji stripping,
slugification, filename format, end-to-end realistic-article shape),
the settings endpoint normaliser (scheme defaulting, trailing-slash
stripping, validation), and the device client (multipart POST shape,
15-second AbortController timeout, and error categorisation across
network / 4xx / 5xx / parse failure).

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the current page's DOM **only when you click the extension**. |
| `scripting` | Inject the content script on-demand into pages that were already open when the extension was installed. |
| `storage` | Persist the device endpoint URL between sessions. Stores **only** the endpoint string — no secrets, no per-article state, no PII. |
| `host_permissions: http://192.168.4.1/*` | The default Companion-sync IP the reader hosts. Pre-granted so the common case needs no runtime prompt. |
| `optional_host_permissions: http://*/* + https://*/*` | The match patterns the popup uses to request just-in-time access to a custom endpoint you save in Settings. The wildcard is the largest set you could ever opt into; the runtime request asks for only the specific origin you typed. |
| Content script on `<all_urls>` | Auto-injects passively on page load so the popup can extract without a chrome.scripting round-trip. It does nothing until it receives a message. |

The extension **does not** request `contextMenus` or `alarms`
permissions in v1.1. See [`PRIVACY.md`](PRIVACY.md) for a full
data-handling statement.

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

These are deferred to keep each release small and reviewable. They
expand the manifest's permission set when they land:

- **Article queue + periodic retry** when the reader is unreachable
  (adds `alarms`)
- **Right-click context menu** "Send to RSVP Nano" on pages, selections,
  and links (adds `contextMenus`)
- **AI extraction fallback** for paywalled / app-shell pages that
  Readability can't crack (adds an optional configurable host permission
  to the user's chosen AI endpoint)
- **Auto-send toggle** so the popup pings the device immediately without
  the user pressing Send

## Security and privacy

- [`SECURITY.md`](SECURITY.md) — security policy and how to report
  vulnerabilities.
- [`PRIVACY.md`](PRIVACY.md) — what data the extension reads and where it
  goes (short answer: nothing leaves your computer in v1).

## License

[MIT](LICENSE). The extension is an independent contributor-side tool;
the RSVP Nano hardware and firmware are separate projects with their own
licenses.
