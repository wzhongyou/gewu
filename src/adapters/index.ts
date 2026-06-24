import { getSettings } from '../shared/storage'
import { ClaudeAdapter } from './claude'
import { OpenAICompatibleAdapter } from './openaiCompatible'
import type { AIAdapter } from './base'

export async function createAdapter(): Promise<AIAdapter> {
  const settings = await getSettings()

  switch (settings.provider) {
    case 'openai-compatible':
      return new OpenAICompatibleAdapter(settings)
    case 'anthropic':
      return new ClaudeAdapter(settings)
    default:
      return new OpenAICompatibleAdapter(settings)
  }
}
