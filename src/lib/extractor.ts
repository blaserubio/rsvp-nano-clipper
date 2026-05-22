import type {
  ContentMessage,
  ExtractResponse,
  ExtractedArticle,
  SimpleResponse,
} from './types'

/**
 * Send a message to the active tab's content script. If the message fails
 * because the content script isn't there yet (the most common cause: page
 * was open before the extension was installed/reloaded), inject it
 * on-demand via chrome.scripting.executeScript and retry once.
 */
async function sendToActiveTab<TResponse>(message: ContentMessage): Promise<TResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    throw new Error('No active tab found.')
  }
  const tabId = tab.id

  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as TResponse
  } catch (firstError) {
    try {
      await injectContentScript(tabId)
    } catch (injectError) {
      throw new Error(formatInjectionFailure(injectError, tab.url))
    }
    try {
      return (await chrome.tabs.sendMessage(tabId, message)) as TResponse
    } catch (retryError) {
      throw new Error(
        `Injected the content script but the page still did not respond. ` +
          `[${describe(retryError)} · originally: ${describe(firstError)}]`,
      )
    }
  }
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

// ---------------------------------------------------------------------------
// Public API used by the popup
// ---------------------------------------------------------------------------

export async function extractFromActiveTab(): Promise<ExtractedArticle> {
  const response = await sendToActiveTab<ExtractResponse>({ type: 'extract' })
  if (!response.ok) throw new Error(response.error)
  return response.article
}

export async function highlightInActiveTab(textContent: string): Promise<number> {
  const response = await sendToActiveTab<SimpleResponse>({
    type: 'highlight',
    textContent,
  })
  if (!response.ok) throw new Error(response.error)
  return response.count
}

export async function unhighlightInActiveTab(): Promise<void> {
  const response = await sendToActiveTab<SimpleResponse>({ type: 'unhighlight' })
  if (!response.ok) throw new Error(response.error)
}

export async function scrollInActiveTab(which: 'first' | 'last'): Promise<void> {
  const response = await sendToActiveTab<SimpleResponse>({ type: 'scroll', which })
  if (!response.ok) throw new Error(response.error)
}
