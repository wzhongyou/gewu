export async function sendMessageToActiveTab<TResponse>(
  message: unknown
): Promise<TResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab.id) {
    throw new Error('未找到当前标签页')
  }

  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as TResponse
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error
    }

    await injectContentScript(tab.id)
    return (await chrome.tabs.sendMessage(tab.id, message)) as TResponse
  }
}

async function injectContentScript(tabId: number): Promise<void> {
  const script = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0]
  if (!script) {
    throw new Error('未找到 content script 配置')
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [script]
  })
}

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Receiving end does not exist')
}
