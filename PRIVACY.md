# Privacy

Short version: **the RSVP Nano Web Clipper does not collect, transmit, or
share anything about you, your browsing, or the pages you clip.**

## What the extension reads

When you click the extension's toolbar icon (or press its keyboard
shortcut), it reads the **DOM of the active tab** in order to extract the
article. This is the same data your browser already has in memory for the
page you're looking at — the extension uses Chrome's `activeTab`
permission, which only grants access while you have explicitly activated
the extension on that tab.

A passive content script is registered for all URLs at install time. Its
only role is to wait for a message from the popup. **It does no work, reads
no data, and contacts no server unless and until the popup messages it
after a user gesture.**

## What the extension does with that data

Everything the extension does happens **locally on your machine and on
your local network** — nothing ever crosses the public internet:

1. **Extraction** runs Mozilla Readability and a fallback paragraph-cluster
   walker on the page DOM. Junk is filtered (ads, navigation, related
   stories, newsletter prompts, etc.). The result is a plain-text article
   body plus a sanitised HTML copy.
2. **Conversion** transforms the extracted text into the RSVP Nano
   device's `.rsvp` format. Unicode is normalised; emojis and unsupported
   characters are stripped.
3. **Send** (v1.1) POSTs the resulting `.rsvp` to the device's HTTP
   endpoint (default `http://192.168.4.1/api/books`), reachable only over
   the reader's own Companion-sync Wi-Fi network. This is a direct
   peer-to-peer LAN call to a device you own. Nothing is sent anywhere
   else.
4. **Download** (always available, and the automatic fallback if Send
   fails) writes the `.rsvp` file to your computer's Downloads folder
   using a normal HTML5 `<a download>` click.

That's the entire data flow in v1.1.

## What the extension does *not* do

- **No public-internet network calls.** The only network calls v1.1
  makes are to the device endpoint you configure — by default the
  Companion-sync IP `http://192.168.4.1`, which is the reader's own
  Wi-Fi AP. If you change the endpoint to a custom value (e.g. a static
  IP on your home network), the extension only talks to that endpoint.
  Verify yourself: every `fetch` call in the source tree targets the
  user-supplied endpoint (`grep -rn 'fetch(' src/`).
- **No analytics, telemetry, error reporting, or crash reporting.**
- **No user accounts, sign-in, or cloud sync.**
- **No data shared with third parties.**
- **No reading-history, bookmarks, browsing data, cookies, passwords,
  forms, or autofill** are accessed.
- **No data retained between sessions** beyond a single field: the
  device endpoint URL string (in `chrome.storage.local`). No article
  content, no extraction history, no PII.
- **No `<all_urls>` host permission**. The extension uses the `activeTab`
  pattern, so it can only see a page when you explicitly activate it.

## What happens to the `.rsvp` file when you Send or Download

**Send** posts the file directly to the device's HTTP endpoint
(`POST /api/books`) over the reader's Companion-sync Wi-Fi network.
Peer-to-peer, never traverses the public internet. The file is
transmitted in plain text (the device's API is HTTP, not HTTPS — same
trust model as the device's own browser uploader).

**Download** writes the file to your computer's Downloads folder. From
there you choose how to get it onto the reader — typically by dropping
it into the device's own `http://192.168.4.1` **Books** page in any
browser.

## Roadmap features that change the privacy story

The following are deliberately **not in v1.1** and will be disclosed
explicitly when added:

- **Article queue** will use `chrome.storage.local` to persist pending
  uploads when the device is offline. Local-only.
- **Optional AI extraction fallback** for paywalled pages will, if and
  only if you explicitly configure it, send page HTML to an
  AI endpoint *you choose and provide credentials for*. Opt-in, off by
  default, never enabled silently.

## Reporting privacy issues

If you find behavior that contradicts anything in this document, please
[open an issue](https://github.com/blaserubio/rsvp-nano-clipper/issues) or
follow the security policy in [`SECURITY.md`](SECURITY.md).
