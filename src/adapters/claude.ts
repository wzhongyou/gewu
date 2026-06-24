import type { ChatMessage, GewuSettings } from '../shared/types'
import type { AIAdapter, TranslateDelta, TranslateInput } from './base'

type ClaudeContentBlockDelta = {
  type: 'content_block_delta'
  delta?: {
    type?: string
    text?: string
  }
}

type ClaudeError = {
  type: 'error'
  error?: {
    message?: string
  }
}

type ClaudeStreamEvent = ClaudeContentBlockDelta | ClaudeError | { type: string }

export class ClaudeAdapter implements AIAdapter {
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

    for await (const text of this.streamMessages([{ role: 'user', content: prompt }], signal)) {
      yield {
        paragraphId: input.paragraph.id,
        text
      }
    }
  }

  async *chat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string> {
    yield* this.streamMessages(messages, signal)
  }

  private async *streamMessages(
    messages: ChatMessage[],
    signal: AbortSignal
  ): AsyncIterable<string> {
    if (!this.settings.apiKey.trim()) {
      throw new Error('请先在设置页填写 API Key')
    }

    const system = messages.find((message) => message.role === 'system')?.content
    const claudeMessages = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content
      }))

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.settings.model,
        max_tokens: 2048,
        stream: true,
        system,
        messages: claudeMessages
      })
    })

    if (!response.ok || !response.body) {
      const detail = await safeReadError(response)
      throw new Error(detail || `模型请求失败：${response.status}`)
    }

    yield* parseClaudeStream(response.body)
  }
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } }
    return payload.error?.message ?? ''
  } catch {
    return ''
  }
}

async function* parseClaudeStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
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

      const event = JSON.parse(json) as ClaudeStreamEvent
      if (isClaudeError(event)) {
        throw new Error(event.error?.message ?? '模型流式响应失败')
      }
      if (isClaudeContentBlockDelta(event) && event.delta?.text) {
        yield event.delta.text
      }
    }
  }
}

function isClaudeError(event: ClaudeStreamEvent): event is ClaudeError {
  return event.type === 'error'
}

function isClaudeContentBlockDelta(event: ClaudeStreamEvent): event is ClaudeContentBlockDelta {
  return event.type === 'content_block_delta'
}
