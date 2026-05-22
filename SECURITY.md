# Security Policy

## Reporting a vulnerability

If you find a security issue, please **don't open a public GitHub issue**.
Instead, open a [private security advisory](https://github.com/blaserubio/rsvp-nano-clipper/security/advisories/new)
on the repository, or email the maintainer.

Include:
- The version (or commit SHA) you tested against.
- Steps to reproduce.
- The impact you believe the issue has.

Reasonable response times: acknowledgement within ~1 week, triage within
~2 weeks. This is a volunteer-maintained open-source project; please be
patient.

## Threat model

The extension's threat model is shaped by what it actually does in v1.1
(see [`PRIVACY.md`](PRIVACY.md) for the full data-flow):

| What it touches | How |
| --- | --- |
| The active tab's DOM | Read-only, on user gesture only (`activeTab`). |
| The active tab's page (side effects) | Clicks visible "Show more" / "Story continues" buttons before extracting. Negative-pattern filter avoids subscribe / login / share / register / cookie-banner buttons. |
| The local filesystem | One `<a download>` click per user request, into the user's Downloads folder. |
| The network | **Only the user-configured device endpoint** (default `http://192.168.4.1`, custom endpoints opt-in via per-origin `chrome.permissions.request`). Two HTTP methods: `POST /api/books` (Send) and `GET /api/info` (Settings → Test connection). Both run only on user gesture. No telemetry, no analytics, no third-party calls. |
| Persistent storage | `chrome.storage.local` holds exactly one value: the device endpoint URL string. No secrets, no PII, no article content. |

### What the extension is NOT a defence against

- A **malicious page** is the active tab. The extension treats page DOM as
  data (parses via `DOMParser`, sanitises HTML via DOMPurify, never
  evaluates) and the extracted `.rsvp` text never executes. But the
  extension does click buttons it identifies as "expand" controls — a
  page that crafts a button labelled "Show more" but whose handler does
  something else could cause that handler to fire. The risk is bounded
  to whatever the page itself can do; nothing privileged crosses the
  extension boundary.
- The **RSVP Nano device** when the user uploads the `.rsvp`. The device
  has its own input validation; this extension produces files that match
  the canonical format produced by the device's own converter.

## Hardening already in place

- **TypeScript strict mode** across all source.
- **No `innerHTML` / `outerHTML` / `dangerouslySetInnerHTML` / `eval` /
  `new Function` / `document.write`** anywhere in `src/`
  (`grep -rnE 'innerHTML|outerHTML|dangerouslySetInnerHTML|eval\(|new Function|document\.write' src/`
  returns empty).
- **DOMPurify** sanitises any HTML produced by Readability before it's
  passed across the message boundary or written into the `.rsvp` body.
  (The `.rsvp` body itself is plain text and is never re-interpreted as
  HTML by the extension or the device.)
- **`DOMParser`** is used to parse the sanitised HTML into events — a
  parse-only, side-effect-free operation.
- **Least-privilege manifest** (v1.1):
  - `activeTab` — only the page you've explicitly invoked the extension on.
  - `scripting` — only used to inject the bundled content script into
    pages that were already open at install time.
  - `storage` — only `chrome.storage.local`, only the device endpoint
    URL string. No secrets, no PII, no article content.
  - `host_permissions: ['http://192.168.4.1/*']` — only the device's
    default Companion-sync IP, pre-granted so the common case avoids
    a permission prompt.
  - `optional_host_permissions: ['http://*/*', 'https://*/*']` — the
    match patterns the Settings panel passes to
    `chrome.permissions.request()` *only* when the user types a custom
    endpoint and clicks Save. The wildcard is the largest possible
    set the user could opt into; the actual runtime request is for
    just the specific origin they typed (e.g. `http://reader.local:8080/*`).
    Chrome shows them a prompt; we only persist if they grant.
  - No `<all_urls>` host permission. No `alarms`. No `contextMenus`.
- **Content script is passive**: registered on all URLs at install time
  so the popup can message it without round-tripping `chrome.scripting`,
  but the only top-level code it runs is a `chrome.runtime.onMessage`
  registration guarded by a window-level flag (to prevent double-
  registration if the on-demand injection path also fires). No DOM
  scraping, no fetch, no storage write happens until a user gesture
  produces a message.
- **Default MV3 Content Security Policy** is preserved — no `unsafe-eval`,
  no `unsafe-inline`, no remote scripts. The extension cannot load code
  from outside its own bundle.
- **Network calls only to the user-configured device endpoint** in v1.1.
  The only `fetch` call sites are `src/lib/deviceClient.ts` (POST
  `/api/books` for Send, GET `/api/info` for Settings → Test). Both
  build the URL from `<endpoint>` (the user-controlled, normalised
  setting); both fire only on a user gesture (clicking Send or Test);
  both have a hard 15-second / 8-second `AbortController` timeout.
  Verifiable with `grep -rnE 'fetch\(|XMLHttpRequest|sendBeacon' src/`.
- **HTTP, not HTTPS**, to the device. The reader's API is HTTP-only
  (same as its own web companion). Data is plaintext over the device's
  local Wi-Fi network. Mixed-content rules don't apply to extension
  contexts. Network is trust-boundary-aware: the connection only
  succeeds when the user has joined the reader's AP, so an attacker
  off that LAN cannot reach it.

## Supply chain

`npm audit` may report **`rollup@2.79.2`** as having a high-severity
advisory ([GHSA-mw96-cpmx-2vgc](https://github.com/advisories/GHSA-mw96-cpmx-2vgc)
— "Arbitrary File Write via Path Traversal"). Notes:

- This package is a **build-time transitive dependency** of
  `@crxjs/vite-plugin@2.x`. It is not part of the extension bundle that
  ships to users; the only way it could be exploited is if an attacker
  controls a CSS file the build imports, and this project does not
  import any CSS files.
- It will be picked up automatically when `@crxjs/vite-plugin` updates
  its rollup pin past 2.80.0.
- If you want to verify yourself that the issue does not reach the
  shipped bundle: `npm run build`, then `cat dist/manifest.json` — the
  bundle that ships is the contents of `dist/`, which does not include
  any `node_modules` code.

## Supported versions

Only the latest release on `main` is supported with security updates.
The extension has no users at scale and is intended for use unpacked
from source; older builds are unsupported.
