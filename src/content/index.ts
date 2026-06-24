import { InlineTranslator } from '../overlay/InlineTranslator'
import { PageTranslator } from '../pageTranslator/PageTranslator'
import { extractPageContext, markPageParagraphs } from '../shared/readability'
import type { RuntimeCommand, RuntimeResponse } from '../shared/types'

let activeTranslator: InlineTranslator | null = null
let activePageTranslator: PageTranslator | null = null

if (window.__GEWU_CONTENT_READY__) {
  // Already injected in this page.
} else {
  window.__GEWU_CONTENT_READY__ = true
  bindRuntimeMessages()
}

function bindRuntimeMessages(): void {
  chrome.runtime.onMessage.addListener((message: RuntimeCommand, _sender, sendResponse) => {
    if (message.type === 'capture-page-context') {
      capturePageContext()
        .then((context) => sendResponse({ ok: true, data: context } satisfies RuntimeResponse))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          } satisfies RuntimeResponse)
        })

      return true
    }

    if (message.type === 'toggle-overlay-translation') {
      toggleOverlayTranslation()
        .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          } satisfies RuntimeResponse)
        })

      return true
    }

    if (message.type !== 'toggle-translation') return false

    toggleTranslation()
      .then(() => sendResponse({ ok: true } satisfies RuntimeResponse))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies RuntimeResponse)
      })

    return true
  })
}

async function capturePageContext() {
  return extractPageContext()
}

async function toggleTranslation(): Promise<void> {
  if (activePageTranslator || PageTranslator.mounted()) {
    activePageTranslator?.destroy()
    activePageTranslator = null
    return
  }

  if (activeTranslator || InlineTranslator.mounted()) {
    activeTranslator?.destroy()
    activeTranslator = null
    return
  }

  activePageTranslator = new PageTranslator(() => {
    activePageTranslator = null
  })
  activePageTranslator.mount()
}

async function toggleOverlayTranslation(): Promise<void> {
  if (activeTranslator || InlineTranslator.mounted()) {
    activeTranslator?.destroy()
    activeTranslator = null
    return
  }

  const context = await capturePageContext()

  if (context.paragraphs.length === 0) {
    throw new Error('没有提取到可翻译的正文')
  }

  const mappedElements = markPageParagraphs(context.paragraphs)
  activeTranslator = new InlineTranslator(context.paragraphs, mappedElements)
  activeTranslator.mount()
}
