import type { GewuSettings, PageContext } from './types'

const SETTINGS_KEY = 'gewu:settings'
const PAGE_CONTEXT_KEY = 'gewu:page-context'

export const defaultSettings: GewuSettings = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  targetLang: 'zh-CN'
}

export async function restrictStorageAccess(): Promise<void> {
  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS'
    })
  }
}

export async function getSettings(): Promise<GewuSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  return {
    ...defaultSettings,
    ...(result[SETTINGS_KEY] as Partial<GewuSettings> | undefined)
  }
}

export async function saveSettings(settings: GewuSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

export async function savePageContext(context: PageContext): Promise<void> {
  await chrome.storage.session.set({ [PAGE_CONTEXT_KEY]: context })
}

export async function getPageContext(): Promise<PageContext | null> {
  const result = await chrome.storage.session.get(PAGE_CONTEXT_KEY)
  return (result[PAGE_CONTEXT_KEY] as PageContext | undefined) ?? null
}
