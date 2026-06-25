import { Save } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultSettings, getSettings, saveSettings } from '../shared/storage'
import type { GewuSettings, Provider } from '../shared/types'
import '../shared/styles.css'
import './styles.css'

function Options(): JSX.Element {
  const [settings, setSettings] = useState<GewuSettings>(defaultSettings)
  const [status, setStatus] = useState('加载中...')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings()
      .then((value) => {
        setSettings(value)
        setStatus('设置已加载')
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error))
      })
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    try {
      await saveSettings(settings)
      setStatus('已保存，正在关闭设置页...')
      window.setTimeout(() => {
        window.close()
      }, 700)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  function selectProvider(provider: Provider): void {
    setSettings((current) => {
      if (provider === 'anthropic') {
        return {
          ...current,
          provider,
          baseUrl: current.provider === provider ? current.baseUrl : 'https://api.anthropic.com',
          model: current.provider === provider ? current.model : 'claude-3-5-sonnet-latest'
        }
      }

      return {
        ...current,
        provider,
        baseUrl: current.provider === provider ? current.baseUrl : 'https://api.deepseek.com',
        model: current.provider === provider ? current.model : 'deepseek-v4-flash'
      }
    })
  }

  return (
    <main className="options">
      <header className="page-header">
        <h1>格物设置</h1>
        <p>配置你的模型服务商。页面内容会由浏览器直接发送给该服务商。API Key 加密存储。</p>
      </header>

      <form className="form" onSubmit={submit}>
        <label>
          <span>服务商</span>
          <select
            value={settings.provider}
            onChange={(event) => selectProvider(event.target.value as Provider)}
          >
            <option value="openai-compatible">DeepSeek / OpenAI 兼容</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </label>

        <label>
          <span>Base URL</span>
          <input
            type="url"
            value={settings.baseUrl}
            placeholder="https://api.deepseek.com"
            onChange={(event) =>
              setSettings((current) => ({ ...current, baseUrl: event.target.value }))
            }
          />
        </label>

        <label>
          <span>API Key</span>
          <input
            type="password"
            value={settings.apiKey}
            placeholder="sk-..."
            onChange={(event) =>
              setSettings((current) => ({ ...current, apiKey: event.target.value }))
            }
          />
        </label>

        <label>
          <span>模型</span>
          <input
            type="text"
            value={settings.model}
            onChange={(event) =>
              setSettings((current) => ({ ...current, model: event.target.value }))
            }
          />
        </label>

        <label>
          <span>目标语言</span>
          <select value={settings.targetLang} disabled>
            <option value="zh-CN">简体中文</option>
          </select>
        </label>

        <button className="save" disabled={saving} type="submit">
          <Save size={18} />
          <span>{saving ? '保存中' : '保存设置'}</span>
        </button>

        <div className="status">{status}</div>
      </form>
    </main>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Options />)
