import { Send, Sparkles } from 'lucide-react'
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getPageContext, savePageContext } from '../shared/storage'
import { consumeLastError, safePostPort } from '../shared/ports'
import { sendMessageToActiveTab } from '../shared/tabs'
import type { ChatEvent, ChatMessage, PageContext, RuntimeResponse } from '../shared/types'
import '../shared/styles.css'
import './styles.css'

type VisibleMessage = {
  role: 'user' | 'assistant'
  content: string
}

function SidePanel(): JSX.Element {
  const [context, setContext] = useState<PageContext | null>(null)
  const [messages, setMessages] = useState<VisibleMessage[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('读取页面上下文...')
  const [busy, setBusy] = useState(false)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const activeUrlRef = useRef<string | null>(null)

  const refreshContext = useCallback(async (): Promise<PageContext | null> => {
    setStatus('读取当前页面正文...')

    try {
      const response = await sendMessageToActiveTab<RuntimeResponse<PageContext>>({
        type: 'capture-page-context'
      })

      if (response.ok && response.data) {
        await savePageContext(response.data)
        return response.data
      }
    } catch {
      // Fall back to the latest captured context below.
    }

    return getPageContext()
  }, [])

  const loadCurrentPageContext = useCallback(async (): Promise<void> => {
    portRef.current?.disconnect()
    portRef.current = null
    setBusy(false)
    setDraft('')
    setMessages([])
    setContext(null)
    setStatus('读取当前页面正文...')

    try {
      const value = await refreshContext()
      activeUrlRef.current = value?.url ?? null
      setContext(value)
      setStatus(value ? '可以提问' : '未能读取当前页面正文')
    } catch (error) {
      activeUrlRef.current = null
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }, [refreshContext])

  useEffect(() => {
    void loadCurrentPageContext()

    const handleActivated = (): void => {
      void loadCurrentPageContext()
    }

    const handleUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ): void => {
      if (changeInfo.status !== 'complete' || !tab.active) return
      void loadCurrentPageContext()
    }

    chrome.tabs.onActivated.addListener(handleActivated)
    chrome.tabs.onUpdated.addListener(handleUpdated)

    return () => {
      portRef.current?.disconnect()
      chrome.tabs.onActivated.removeListener(handleActivated)
      chrome.tabs.onUpdated.removeListener(handleUpdated)
    }
  }, [loadCurrentPageContext])

  const systemPrompt = useMemo(() => {
    if (!context) return ''
    const summary = context.paragraphs
      .slice(0, 20)
      .map((paragraph) => paragraph.text)
      .join('\n\n')
      .slice(0, 6000)

    return [
      '你是一个阅读助手，帮助用户理解以下网页内容。',
      '用中文回答，简洁准确。',
      '',
      `页面标题：${context.title}`,
      `页面 URL：${context.url}`,
      `页面内容：${summary}`
    ].join('\n')
  }, [context])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await sendQuestion()
  }

  async function sendQuestion(): Promise<void> {
    const question = draft.trim()
    if (!question || busy) return
    if (!context) {
      setStatus('当前页面还没有可用上下文')
      return
    }

    setDraft('')
    setBusy(true)
    setStatus('正在生成回答...')
    setMessages((current) => [...current, { role: 'user', content: question }, { role: 'assistant', content: '' }])

    const requestId = crypto.randomUUID()
    const port = chrome.runtime.connect({ name: 'chat' })
    portRef.current = port

    port.onDisconnect.addListener(() => {
      consumeLastError()
      portRef.current = null
      setBusy(false)
    })

    port.onMessage.addListener((eventMessage: ChatEvent) => {
      if (eventMessage.requestId !== requestId) return

      if (eventMessage.type === 'delta') {
        setMessages((current) => {
          const next = [...current]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, content: last.content + eventMessage.text }
          }
          return next
        })
        return
      }

      if (eventMessage.type === 'done') {
        setBusy(false)
        setStatus(activeUrlRef.current === context.url ? '可以继续提问' : '页面已切换')
        port.disconnect()
        return
      }

      setBusy(false)
      setStatus(eventMessage.message)
    })

    const history: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-8).map((message) => ({
        role: message.role,
        content: message.content
      })),
      { role: 'user', content: question }
    ]

    const posted = safePostPort(port, {
      type: 'chat',
      requestId,
      messages: history
    })
    if (!posted) {
      setBusy(false)
      setStatus('连接已断开，请重试')
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    void sendQuestion()
  }

  return (
    <main className="sidepanel">
      <header className="header">
        <img className="logo-mark" src="/icons/icon_48.png" alt="" />
        <div>
          <h1>
            格物问答
            <span className={`status-dot ${busy ? 'working' : ''}`} />
          </h1>
          <p>{context?.title ?? '暂无页面上下文'}</p>
        </div>
      </header>

      <section className="messages">
        {messages.length === 0 ? (
          <div className="empty">
            <Sparkles size={18} />
            <span>围绕当前页面提问。</span>
          </div>
        ) : (
          messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              {message.content || '...'}
            </article>
          ))
        )}
      </section>

      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            value={draft}
            placeholder="输入问题"
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <button disabled={busy || !draft.trim()} type="submit" title="发送">
            <Send size={17} />
          </button>
        </div>
      </form>

      <div className="status">{status}</div>
    </main>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<SidePanel />)
