import { MessageSquare, Settings, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/styles.css'
import './styles.css'
import type { RuntimeResponse } from '../shared/types'
import { sendMessageToActiveTab } from '../shared/tabs'

function Popup(): JSX.Element {
  const [status, setStatus] = useState('准备就绪')
  const [busy, setBusy] = useState(false)

  async function toggleTranslation(): Promise<void> {
    setBusy(true)
    setStatus('正在处理当前页...')
    try {
      const response = await sendMessageToActiveTab<RuntimeResponse>({
        type: 'toggle-translation'
      })
      if (!response.ok) throw new Error(response.error ?? '启动失败')
      await openSidePanel()
      setStatus('已开始翻译，并打开问答')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function openOptions(): Promise<void> {
    await chrome.runtime.openOptionsPage()
  }

  async function openSidePanel(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId })
    }
  }

  return (
    <main className="popup">
      <header>
        <div className="brand">格物</div>
        <div className="tagline">双栏翻译与页面问答</div>
      </header>

      <button className="primary" disabled={busy} type="button" onClick={toggleTranslation}>
        <Wand2 size={17} />
        <span>{busy ? '处理中' : '翻译当前页'}</span>
      </button>

      <div className="actions">
        <button type="button" onClick={openSidePanel} title="打开问答侧栏">
          <MessageSquare size={17} />
          <span>问答</span>
        </button>
        <button type="button" onClick={openOptions} title="打开设置">
          <Settings size={17} />
          <span>设置</span>
        </button>
      </div>

      <div className="status">{status}</div>
    </main>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Popup />)
