export type Provider = 'openai-compatible' | 'anthropic' | 'ollama'

export type TargetLang = 'zh-CN'

export type GewuSettings = {
  provider: Provider
  baseUrl: string
  apiKey: string
  model: string
  targetLang: TargetLang
}

export type PageParagraph = {
  id: string
  text: string
}

export type PageContext = {
  title: string
  url: string
  excerpt: string
  paragraphs: PageParagraph[]
  capturedAt: number
}

export type TranslateRequest = {
  type: 'translate'
  requestId: string
  paragraphs: PageParagraph[]
  targetLang: TargetLang
  url?: string
}

export type TranslateBatchRequest = {
  type: 'translate-batch'
  requestId: string
  batchId?: string
  paragraphs: PageParagraph[]
  targetLang: TargetLang
  url?: string
}

export type TranslateControlRequest = {
  type: 'abort'
  requestId: string
}

export type TranslationEvent =
  | {
      type: 'delta'
      requestId: string
      paragraphId: string
      text: string
    }
  | {
      type: 'done'
      requestId: string
      paragraphId?: string
    }
  | {
      type: 'error'
      requestId: string
      paragraphId?: string
      message: string
    }
  | {
      type: 'batch'
      requestId: string
      translations: PageParagraph[]
    }

export type RuntimeCommand =
  | { type: 'toggle-translation' }
  | { type: 'toggle-overlay-translation' }
  | { type: 'open-reader' }
  | { type: 'open-options' }
  | { type: 'capture-page-context' }
  | { type: 'check-is-pdf'; url: string }

export type RuntimeResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type ChatRequest = {
  type: 'chat'
  requestId: string
  messages: ChatMessage[]
}

export type ChatEvent =
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string }
