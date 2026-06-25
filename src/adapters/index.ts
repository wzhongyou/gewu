import { getSettings } from '../shared/storage'
import { ClaudeAdapter } from './claude'
import { OllamaAdapter } from './ollama'
import { OpenAICompatibleAdapter } from './openaiCompatible'
import type { AIAdapter } from './base'

export async function createAdapter(): Promise<AIAdapter> {
  const settings = await getSettings()

  switch (settings.provider) {
    case 'openai-compatible':
      return new OpenAICompatibleAdapter(settings)
    case 'anthropic':
      return new ClaudeAdapter(settings)
    case 'ollama':
      return new OllamaAdapter(settings)
    default:
      return new OpenAICompatibleAdapter(settings)
  }
}
