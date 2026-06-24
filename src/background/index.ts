import { createAdapter } from '../adapters'
import { getPageContext, getSettings, restrictStorageAccess } from '../shared/storage'
import { consumeLastError } from '../shared/ports'
import type {
  ChatEvent,
  ChatRequest,
  RuntimeCommand,
  RuntimeResponse,
  TranslateBatchRequest,
  TranslateControlRequest,
  TranslateRequest,
  TranslationEvent
} from '../shared/types'

const activeRequests = new Map<string, AbortController>()

chrome.runtime.onInstalled.addListener(() => {
  restrictStorageAccess().catch((error) => {
    console.error('Failed to restrict storage access', error)
  })
})

chrome.runtime.onStartup.addListener(() => {
  restrictStorageAccess().catch((error) => {
    console.error('Failed to restrict storage access', error)
  })
})

chrome.runtime.onMessage.addListener((message: RuntimeCommand, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies RuntimeResponse)
    })
  return true
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'translation') {
    bindTranslationPort(port)
    return
  }
  if (port.name === 'chat') {
    bindChatPort(port)
  }
})

async function handleRuntimeMessage(
  message: RuntimeCommand,
  sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse> {
  if (message.type === 'toggle-translation') {
    if (!sender.tab?.id) {
      return { ok: false, error: '未找到当前标签页' }
    }
    await chrome.tabs.sendMessage(sender.tab.id, { type: 'toggle-translation' })
    return { ok: true }
  }

  if (message.type === 'open-options') {
    await chrome.runtime.openOptionsPage()
    return { ok: true }
  }

  if (message.type === 'capture-page-context') {
    const context = await getPageContext()
    return { ok: true, data: context }
  }

  return { ok: false, error: '未知命令' }
}

function bindTranslationPort(port: chrome.runtime.Port): void {
  port.onMessage.addListener((message: TranslateRequest | TranslateBatchRequest | TranslateControlRequest) => {
    if (message.type === 'abort') {
      abortRequest(message.requestId)
      return
    }

    const task =
      message.type === 'translate-batch'
        ? translateBatch(message, port)
        : translateAll(message, port)

    task.catch((error) => {
      postPort(port, {
        type: 'error',
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error)
      } satisfies TranslationEvent)
    })
  })

  port.onDisconnect.addListener(() => {
    consumeLastError()
    for (const controller of activeRequests.values()) {
      controller.abort()
    }
    activeRequests.clear()
  })
}

async function translateBatch(
  request: TranslateBatchRequest,
  port: chrome.runtime.Port
): Promise<void> {
  const adapter = await createAdapter()
  const settings = await getSettings()
  const controller = new AbortController()
  const activeKey = request.batchId ? `${request.requestId}:${request.batchId}` : request.requestId
  activeRequests.set(activeKey, controller)

  try {
    const chunks = chunkParagraphs(request.paragraphs, 12)
    let completed = 0

    for (let index = 0; index < chunks.length; index += 2) {
      if (controller.signal.aborted) break

      const window = chunks.slice(index, index + 2)
      const results = await Promise.all(
        window.map(async (chunk) => {
          if (adapter.translateBatch) {
            return adapter.translateBatch(
              chunk.map((paragraph) => ({ paragraph, targetLang: settings.targetLang })),
              controller.signal
            )
          }

          const translated = []
          for (const paragraph of chunk) {
            let text = ''
            for await (const delta of adapter.translate(
              { paragraph, targetLang: settings.targetLang },
              controller.signal
            )) {
              text += delta.text
            }
            translated.push({ paragraphId: paragraph.id, text })
          }
          return translated
        })
      )

      for (const result of results.flat()) {
        completed += 1
        postPort(port, {
          type: 'batch',
          requestId: request.requestId,
          translations: [{ id: result.paragraphId, text: result.text }]
        } satisfies TranslationEvent)
      }

      postPort(port, {
        type: 'batch',
        requestId: request.requestId,
        translations: [{ id: '__progress__', text: String(completed) }]
      } satisfies TranslationEvent)
    }

    if (!request.batchId) {
      postPort(port, {
        type: 'done',
        requestId: request.requestId
      } satisfies TranslationEvent)
    }
  } finally {
    activeRequests.delete(activeKey)
  }
}

async function translateAll(request: TranslateRequest, port: chrome.runtime.Port): Promise<void> {
  const adapter = await createAdapter()
  const settings = await getSettings()
  const controller = new AbortController()
  activeRequests.set(request.requestId, controller)

  try {
    for (const paragraph of request.paragraphs) {
      if (controller.signal.aborted) break

      try {
        for await (const delta of adapter.translate(
          {
            paragraph,
            targetLang: settings.targetLang
          },
          controller.signal
        )) {
          postPort(port, {
            type: 'delta',
            requestId: request.requestId,
            paragraphId: delta.paragraphId,
            text: delta.text
          } satisfies TranslationEvent)
        }

        postPort(port, {
          type: 'done',
          requestId: request.requestId,
          paragraphId: paragraph.id
        } satisfies TranslationEvent)
      } catch (error) {
        postPort(port, {
          type: 'error',
          requestId: request.requestId,
          paragraphId: paragraph.id,
          message: error instanceof Error ? error.message : String(error)
        } satisfies TranslationEvent)
      }
    }

    postPort(port, {
      type: 'done',
      requestId: request.requestId
    } satisfies TranslationEvent)
  } finally {
    activeRequests.delete(request.requestId)
  }
}

function bindChatPort(port: chrome.runtime.Port): void {
  port.onMessage.addListener((request: ChatRequest) => {
    if (request.type !== 'chat') return

    const controller = new AbortController()
    activeRequests.set(request.requestId, controller)

    createAdapter()
      .then(async (adapter) => {
        for await (const text of adapter.chat(request.messages, controller.signal)) {
          postPort(port, {
            type: 'delta',
            requestId: request.requestId,
            text
          } satisfies ChatEvent)
        }
        postPort(port, { type: 'done', requestId: request.requestId } satisfies ChatEvent)
      })
      .catch((error) => {
        postPort(port, {
          type: 'error',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error)
        } satisfies ChatEvent)
      })
      .finally(() => {
        activeRequests.delete(request.requestId)
      })
  })

  port.onDisconnect.addListener(() => {
    consumeLastError()
    for (const controller of activeRequests.values()) {
      controller.abort()
    }
    activeRequests.clear()
  })
}

function postPort(port: chrome.runtime.Port, message: TranslationEvent | ChatEvent): void {
  try {
    port.postMessage(message)
  } catch {
    // The receiving view was closed.
  }
}

function chunkParagraphs<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function abortRequest(requestId: string): void {
  for (const [key, controller] of activeRequests.entries()) {
    if (key === requestId || key.startsWith(`${requestId}:`)) {
      controller.abort()
      activeRequests.delete(key)
    }
  }
}
