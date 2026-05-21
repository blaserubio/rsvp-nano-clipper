import type { ExtractResponse, ExtractedArticle } from './types'

/**
 * Ask the active tab to extract the current article via Readability.
 *
 * Fast path: send a message to the already-present content script.
 *
 * Fallback: if the message fails ("Receiving end does not exist") it usually
 * means the page was loaded before this extension was installed/reloaded, so
 * the auto-injected content script was never there. We programmatically
 * inject it on demand using chrome.scripting.executeScript and retry.
 *
 * A later step will also wire up the AI-endpoint fallback for when Readability
 * itself returns nothing useful.
 */
export async function extractFromActiveTab(): Promise<ExtractedArticle> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    throw new Error('No active tab found.')
  }
  const tabId = tab.id

  let response: ExtractResponse
  try {
    response = await sendExtractRequest(tabId)
  } catch (firstError) {
    // Most likely cause: page was open before the extension was installed.
    try {
      await injectContentScript(tabId)
    } catch (injectError) {
      throw new Error(formatInjectionFailure(injectError, tab.url))
    }
    try {
      response = await sendExtractRequest(tabId)
    } catch (retryError) {
      throw new Error(
        `Injected the content script but the page still did not respond. ` +
          `[${describe(retryError)} · originally: ${describe(firstError)}]`,
      )
    }
  }

  if (!response.ok) {
    throw new Error(response.error)
  }
  return response.article
}

async function sendExtractRequest(tabId: number): Promise<ExtractResponse> {
  return (await chrome.tabs.sendMessage(tabId, {
    type: 'extract',
  })) as ExtractResponse
}

async function injectContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest()
  const files = manifest.content_scripts?.[0]?.js ?? []
  if (files.length === 0) {
    throw new Error('No content script declared in the manifest.')
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files,
    injectImmediately: true,
  })
}

function formatInjectionFailure(error: unknown, tabUrl: string | undefined): string {
  const msg = describe(error)
  // Chrome refuses to inject into its own pages (chrome://, the Web Store,
  // file:// without permission, etc.). Make that explanation explicit.
  if (
    tabUrl &&
    (tabUrl.startsWith('chrome://') ||
      tabUrl.startsWith('chrome-extension://') ||
      tabUrl.startsWith('edge://') ||
      tabUrl.startsWith('about:') ||
      tabUrl.includes('chrome.google.com/webstore') ||
      tabUrl.includes('chromewebstore.google.com'))
  ) {
    return `This page (${tabUrl.split('/')[2] ?? 'browser-internal'}) is a browser system page. Open a normal article and try again.`
  }
  return `Could not inject into this page. [${msg}]`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}
