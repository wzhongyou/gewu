import type { ChatMessage, GewuSettings } from '../shared/types'
import type { AIAdapter, TranslateDelta, TranslateInput } from './base'

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string
    }
    finish_reason?: string | null
  }>
  error?: {
    message?: string
  }
}

type OpenAICompletion = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: {
    message?: string
  }
}

export class OpenAICompatibleAdapter implements AIAdapter {
  constructor(private readonly settings: GewuSettings) {}

  async *translate(input: TranslateInput, signal: AbortSignal): AsyncIterable<TranslateDelta> {
    const prompt = [
      '你是一名专业学术翻译，将以下文本翻译为简体中文。',
      '要求：',
      '- 保留必要的专业术语原文，并在括号中标注。',
      '- 保持段落结构。',
      '- 不添加解释，只输出译文。',
      '',
      `原文：${input.paragraph.text}`
    ].join('\n')

    for await (const text of this.streamChat([{ role: 'user', content: prompt }], signal)) {
      yield {
        paragraphId: input.paragraph.id,
        text
      }
    }
  }

  async *chat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string> {
    yield* this.streamChat(messages, signal)
  }

  async translateBatch(
    inputs: TranslateInput[],
    signal: AbortSignal
  ): Promise<TranslateDelta[]> {
    if (!this.settings.apiKey.trim()) {
      throw new Error('请先在设置页填写 API Key')
    }

    const payload = inputs.map((input) => ({
      id: input.paragraph.id,
      text: input.paragraph.text
    }))

    const prompt = [
      '你是一名专业学术翻译。请把 JSON 数组中每个 text 翻译为简体中文。',
      '要求：',
      '- 保持数组长度、顺序和 id 不变。',
      '- 必须完整翻译每个 text，不能遗漏句子，不能只翻译前半段。',
      '- 保留引用标记、公式编号、专有名词必要原文和链接文本含义。',
      '- 形如 ⟦GEWU_1⟧ 的占位符代表网页里的链接、公式或代码，必须逐字保留原位置，不能翻译、删除、改写或重排。',
      '- 只返回 JSON 数组，不要 Markdown，不要解释。',
      '- 输出格式必须是 {"translations":[{"id":"...","text":"译文"}]}。',
      '',
      JSON.stringify(payload)
    ].join('\n')

    const content = await this.completeChat([{ role: 'user', content: prompt }], signal)
    const parsed = parseBatchTranslations(content)

    return inputs.map((input) => ({
      paragraphId: input.paragraph.id,
      text:
        parsed.get(input.paragraph.id) ??
        input.paragraph.text
    }))
  }

  private async *streamChat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string> {
    if (!this.settings.apiKey.trim()) {
      throw new Error('请先在设置页填写 API Key')
    }

    const response = await fetch(`${normalizeBaseUrl(this.settings.baseUrl)}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${this.settings.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        stream: true,
        temperature: 0.2
      })
    })

    if (!response.ok || !response.body) {
      const detail = await safeReadError(response)
      throw new Error(detail || `模型请求失败：${response.status}`)
    }

    yield* parseOpenAIStream(response.body)
  }

  private async completeChat(messages: ChatMessage[], signal: AbortSignal): Promise<string> {
    const response = await fetch(`${normalizeBaseUrl(this.settings.baseUrl)}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${this.settings.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        stream: false,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const detail = await safeReadError(response)
      throw new Error(detail || `模型请求失败：${response.status}`)
    }

    const payload = (await response.json()) as OpenAICompletion
    if (payload.error?.message) {
      throw new Error(payload.error.message)
    }

    return payload.choices?.[0]?.message?.content ?? ''
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as OpenAIStreamChunk
    return payload.error?.message ?? ''
  } catch {
    return ''
  }
}

async function* parseOpenAIStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const json = trimmed.slice(5).trim()
      if (!json || json === '[DONE]') continue

      const chunk = JSON.parse(json) as OpenAIStreamChunk
      if (chunk.error?.message) {
        throw new Error(chunk.error.message)
      }

      const text = chunk.choices?.[0]?.delta?.content
      if (text) yield text
    }
  }
}

function parseBatchTranslations(content: string): Map<string, string> {
  const normalized = stripCodeFence(content.trim())
  const parsed = JSON.parse(normalized) as
    | Array<{ id?: string; text?: string }>
    | { translations?: Array<{ id?: string; text?: string }> }

  const items = Array.isArray(parsed) ? parsed : parsed.translations ?? []
  return new Map(
    items
      .filter((item) => item.id && typeof item.text === 'string')
      .map((item) => [item.id as string, item.text as string])
  )
}

function stripCodeFence(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}
