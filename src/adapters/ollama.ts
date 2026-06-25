import type { ChatMessage, GewuSettings } from '../shared/types'
import type { AIAdapter, TranslateDelta, TranslateInput } from './base'

type OllamaStreamChunk = {
  choices?: Array<{
    delta?: { content?: string }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

export class OllamaAdapter implements AIAdapter {
  constructor(private readonly settings: GewuSettings) {}

  async *translate(
    input: TranslateInput,
    signal: AbortSignal
  ): AsyncIterable<TranslateDelta> {
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
      yield { paragraphId: input.paragraph.id, text }
    }
  }

  async *chat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string> {
    yield* this.streamChat(messages, signal)
  }

  private async *streamChat(
    messages: ChatMessage[],
    signal: AbortSignal
  ): AsyncIterable<string> {
    const baseUrl = normalizeBaseUrl(this.settings.baseUrl)
    const model = this.settings.model || 'llama3'

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.2
      })
    })

    if (!response.ok || !response.body) {
      const detail = await safeReadError(response)
      throw new Error(detail || `Ollama 请求失败：${response.status}`)
    }

    yield* parseStream(response.body)
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as OllamaStreamChunk
    return payload.error?.message ?? ''
  } catch {
    return ''
  }
}

async function* parseStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
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

      const chunk = JSON.parse(json) as OllamaStreamChunk
      if (chunk.error?.message) {
        throw new Error(chunk.error.message)
      }

      const text = chunk.choices?.[0]?.delta?.content
      if (text) yield text
    }
  }
}
