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

The extension's threat model is shaped by what it actually does in v1
(see [`PRIVACY.md`](PRIVACY.md) for the full data-flow):

| What it touches | How |
| --- | --- |
| The active tab's DOM | Read-only, on user gesture only (`activeTab`). |
| The active tab's page (side effects) | Clicks visible "Show more" / "Story continues" buttons before extracting. Negative-pattern filter avoids subscribe / login / share / register / cookie-banner buttons. |
| The local filesystem | One `<a download>` click per user request, into the user's Downloads folder. |
| The network | **Nothing in v1.** Zero outbound requests. |

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
- **Least-privilege manifest** (v1):
  - `activeTab` — only the page you've explicitly invoked the extension on.
  - `scripting` — only used to inject the bundled content script into
    pages that were already open at install time.
  - No `<all_urls>` host permission. No `storage`. No `alarms`. No
    `contextMenus`.
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
- **No external network calls** in v1. Verifiable with
  `grep -rnE 'fetch\(|XMLHttpRequest|navigator\.sendBeacon' src/`.

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
