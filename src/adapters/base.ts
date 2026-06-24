import type { ChatMessage, PageParagraph, TargetLang } from '../shared/types'

export type TranslateInput = {
  paragraph: PageParagraph
  targetLang: TargetLang
}

export type TranslateDelta = {
  paragraphId: string
  text: string
}

export interface AIAdapter {
  translate(input: TranslateInput, signal: AbortSignal): AsyncIterable<TranslateDelta>
  translateBatch?(
    inputs: TranslateInput[],
    signal: AbortSignal
  ): Promise<TranslateDelta[]>
  chat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string>
}
