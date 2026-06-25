import { decryptApiKey, encryptApiKey, isEncryptedBlob } from './encryption'
import type { GewuSettings, PageContext } from './types'

const SETTINGS_KEY = 'gewu:settings'
const PAGE_CONTEXT_KEY = 'gewu:page-context'

export const defaultSettings: GewuSettings = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-v4-flash',
  targetLang: 'zh-CN'
}

export async function restrictStorageAccess(): Promise<void> {
  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS'
    })
  }
}

/**
 * Read settings, transparently decrypting the API key.
 */
export async function getSettings(): Promise<GewuSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  const raw = (result[SETTINGS_KEY] ?? {}) as Record<string, unknown>

  const settings: GewuSettings = {
    ...defaultSettings,
    ...(raw as Partial<GewuSettings>)
  }

  if (isEncryptedBlob(raw.apiKey)) {
    try {
      settings.apiKey = await decryptApiKey(raw.apiKey)
    } catch {
      settings.apiKey = ''
    }
  }

  return settings
}

/**
 * Save settings. The API key is automatically encrypted before writing to
 * local storage so it is never stored in plaintext on disk.
 */
export async function saveSettings(settings: GewuSettings): Promise<void> {
  const payload: Record<string, unknown> = { ...settings }

  if (settings.apiKey.trim()) {
    payload.apiKey = await encryptApiKey(settings.apiKey)
  }

  await chrome.storage.local.set({ [SETTINGS_KEY]: payload })
}

export async function savePageContext(context: PageContext): Promise<void> {
  await chrome.storage.session.set({ [PAGE_CONTEXT_KEY]: context })
}

export async function getPageContext(): Promise<PageContext | null> {
  const result = await chrome.storage.session.get(PAGE_CONTEXT_KEY)
  return (result[PAGE_CONTEXT_KEY] as PageContext | undefined) ?? null
}
