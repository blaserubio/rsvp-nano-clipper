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

Everything the extension does happens **locally inside your browser**:

1. **Extraction** runs Mozilla Readability and a fallback paragraph-cluster
   walker on the page DOM. Junk is filtered (ads, navigation, related
   stories, newsletter prompts, etc.). The result is a plain-text article
   body plus a sanitised HTML copy.
2. **Conversion** transforms the extracted text into the RSVP Nano
   device's `.rsvp` format. Unicode is normalised; emojis and unsupported
   characters are stripped.
3. **Download** writes the resulting `.rsvp` file to your computer's
   Downloads folder using a normal HTML5 `<a download>` click.

That's the entire data flow in v1.

## What the extension does *not* do

- **No network calls.** The extension makes zero outbound requests in v1.
  Verify yourself with `grep -rn 'fetch\|XMLHttpRequest\|sendBeacon' src/`
  in the source tree.
- **No analytics, telemetry, error reporting, or crash reporting.**
- **No user accounts, sign-in, or cloud sync.**
- **No data shared with third parties.**
- **No reading-history, bookmarks, browsing data, cookies, passwords,
  forms, or autofill** are accessed.
- **No `storage` permission** is requested in v1. The extension stores no
  state between sessions.
- **No `<all_urls>` host permission**. The extension uses the `activeTab`
  pattern, so it can only see a page when you explicitly activate it.

## What happens to the `.rsvp` file you download

The downloaded file is a normal file on your computer's disk. You choose
when and how to send it to your RSVP Nano device. The recommended path —
the device's own Companion-sync browser uploader at `http://192.168.4.1`
— is a peer-to-peer connection over the device's own Wi-Fi network; the
file never traverses the public internet.

## Roadmap features that change the privacy story

The following are deliberately **not in v1** and will be disclosed
explicitly when added:

- **Direct device upload** will POST the file to `http://192.168.4.1` over
  the device's local Wi-Fi network. Still no public-internet traffic.
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
