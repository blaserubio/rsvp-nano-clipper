import type { ExtractResponse, ExtractedArticle } from './types'

/**
 * Ask the active tab's content script to extract the current article.
 *
 * In a later step this will also wire up the AI-endpoint fallback when
 * Readability returns nothing useful.
 */
export async function extractFromActiveTab(): Promise<ExtractedArticle> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    throw new Error('No active tab found.')
  }

  let response: ExtractResponse
  try {
    response = (await chrome.tabs.sendMessage(tab.id, {
      type: 'extract',
    })) as ExtractResponse
  } catch (e) {
    // The most common cause: the page was open before this extension was
    // installed (or reloaded), so the content script was never injected.
    throw new Error(
      `Could not reach the page. Reload it (⌘R) and try again. ` +
        `[${e instanceof Error ? e.message : 'unknown error'}]`,
    )
  }

  if (!response.ok) {
    throw new Error(response.error)
  }
  return response.article
}
