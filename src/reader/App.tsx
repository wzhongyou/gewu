import { ArrowLeft, Languages } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPageContext } from '../shared/storage'
import { consumeLastError, safePostPort } from '../shared/ports'
import type { PageContext, PageParagraph, TranslationEvent } from '../shared/types'

type ParagraphState = 'pending' | 'active' | 'done' | 'error'

type TranslationState = {
  [paragraphId: string]: {
    text: string
    state: ParagraphState
    error?: string
  }
}

export function App(): JSX.Element {
  const [context, setContext] = useState<PageContext | null>(null)
  const [status, setStatus] = useState('加载页面内容...')
  const [translating, setTranslating] = useState(false)
  const [translations, setTranslations] = useState<TranslationState>({})
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const paragraphRefs = useRef<Map<string, HTMLElement>>(new Map())

  useEffect(() => {
    void loadContext()
    return () => {
      abortTranslation()
      observerRef.current?.disconnect()
    }
  }, [])

  async function loadContext(): Promise<void> {
    try {
      const value = await getPageContext()
      if (!value || value.paragraphs.length === 0) {
        setStatus('未能读取页面内容。请回到原网页，点击翻译后再试。')
        return
      }
      setContext(value)
      setStatus(`共 ${value.paragraphs.length} 段`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const doneCountRef = useRef(0)

  const startTranslation = useCallback(() => {
    if (!context || translating) return

    setTranslating(true)
    const total = context.paragraphs.length
    doneCountRef.current = 0
    setStatus(`正在翻译 0/${total} 段...`)

    const initial: TranslationState = {}
    for (const paragraph of context.paragraphs) {
      initial[paragraph.id] = { text: '', state: 'pending' }
    }
    setTranslations(initial)

    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    const port = chrome.runtime.connect({ name: 'translation' })
    portRef.current = port

    port.onMessage.addListener((event: TranslationEvent) => {
      if (event.requestId !== requestId) return

      if (event.type === 'delta') {
        setTranslations((current) => {
          const existing = current[event.paragraphId]
          if (!existing) return current
          return {
            ...current,
            [event.paragraphId]: {
              ...existing,
              text: existing.text + event.text,
              state: 'active' as ParagraphState
            }
          }
        })
        setStatus('正在接收译文')
        return
      }

      if (event.type === 'done') {
        const paragraphId = event.paragraphId
        if (paragraphId) {
          doneCountRef.current += 1
          setTranslations((current) => {
            const existing = current[paragraphId]
            if (!existing) return current
            return {
              ...current,
              [paragraphId]: { ...existing, state: 'done' as ParagraphState }
            }
          })
          setStatus(`已翻译 ${doneCountRef.current}/${total} 段`)
          return
        }
        setStatus('翻译完成')
        setTranslating(false)
        return
      }

      if (event.type === 'batch') {
        return
      }

      // error
      setStatus(event.message)
      const errorId = event.paragraphId
      const errorMessage = event.message
      if (errorId) {
        setTranslations((current) => {
          const existing = current[errorId]
          if (!existing) return current
          return {
            ...current,
            [errorId]: {
              ...existing,
              state: 'error' as ParagraphState,
              error: errorMessage
            }
          }
        })
      }
    })

    port.onDisconnect.addListener(() => {
      consumeLastError()
      portRef.current = null
      if (requestIdRef.current === requestId && translating) {
        setStatus('连接已断开')
        setTranslating(false)
      }
    })

    safePostPort(port, {
      type: 'translate',
      requestId,
      paragraphs: context.paragraphs,
      targetLang: 'zh-CN',
      url: context.url
    })
  }, [context, translating])

  function abortTranslation(): void {
    const requestId = requestIdRef.current
    if (requestId) {
      safePostPort(portRef.current, { type: 'abort', requestId })
      requestIdRef.current = null
    }
    portRef.current?.disconnect()
    portRef.current = null
  }

  function stopTranslation(): void {
    abortTranslation()
    setTranslating(false)
    setStatus('翻译已停止')
  }

  function handleClose(): void {
    window.close()
  }

  // Scroll sync: observe original paragraphs, scroll right panel to match
  const bindScrollSync = useCallback(
    (originalContainer: HTMLDivElement | null, translationContainer: HTMLDivElement | null) => {
      observerRef.current?.disconnect()

      if (!originalContainer || !translationContainer) return

      const entries = Array.from(
        originalContainer.querySelectorAll<HTMLElement>('[data-reader-paragraph-id]')
      )

      if (entries.length === 0) return

      paragraphRefs.current.clear()
      for (const element of entries) {
        const id = element.dataset.readerParagraphId
        if (id) paragraphRefs.current.set(id, element)
      }

      observerRef.current = new IntersectionObserver(
        (items) => {
          const visible = items
            .filter((item) => item.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]

          const id = (visible?.target as HTMLElement | undefined)?.dataset.readerParagraphId
          if (!id) return

          const target = translationContainer.querySelector<HTMLElement>(
            `[data-reader-paragraph-id="${id}"]`
          )
          target?.scrollIntoView({ block: 'nearest' })
        },
        { threshold: [0.2, 0.5, 0.8] }
      )

      for (const element of entries) {
        observerRef.current.observe(element)
      }
    },
    []
  )

  // Set up refs and scroll sync after mount
  const leftCallback = useCallback(
    (node: HTMLDivElement | null) => {
      ;(leftRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      if (node && rightRef.current) bindScrollSync(node, rightRef.current)
    },
    [bindScrollSync]
  )

  const rightCallback = useCallback(
    (node: HTMLDivElement | null) => {
      ;(rightRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      if (node && leftRef.current) bindScrollSync(leftRef.current, node)
    },
    [bindScrollSync]
  )

  if (!context) {
    return (
      <main className="reader">
        <header className="reader-header">
          <div className="reader-brand">
            <img className="logo-mark" src="/icons/icon_48.png" alt="" />
            <span>格物阅读</span>
          </div>
          <button className="reader-close" type="button" onClick={handleClose}>
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>
        </header>
        <div className="reader-empty">{status}</div>
      </main>
    )
  }

  return (
    <main className="reader">
      <header className="reader-header">
        <div className="reader-brand">
          <img className="logo-mark" src="/icons/icon_48.png" alt="" />
          <div>
            <h1>{context.title}</h1>
            <p className="reader-source">{context.url}</p>
          </div>
        </div>

        <div className="reader-actions">
          {translating ? (
            <button className="reader-button secondary" type="button" onClick={stopTranslation}>
              停止翻译
            </button>
          ) : (
            <button
              className="reader-button primary"
              type="button"
              onClick={startTranslation}
            >
              <Languages size={18} />
              <span>翻译</span>
            </button>
          )}
          <button className="reader-button secondary" type="button" onClick={handleClose}>
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>
        </div>
      </header>

      <div className="reader-status" data-active={translating}>
        {status}
      </div>

      <div className="reader-columns">
        <div className="reader-left" ref={leftCallback}>
          <div className="reader-section-title">原文</div>
          {context.paragraphs.map((paragraph) => (
            <ParagraphBlock
              key={paragraph.id}
              paragraph={paragraph}
              translation={translations[paragraph.id]}
            />
          ))}
        </div>

        <div className="reader-right" ref={rightCallback}>
          <div className="reader-section-title">译文</div>
          {context.paragraphs.map((paragraph) => {
            const t = translations[paragraph.id]
            return (
              <p
                key={paragraph.id}
                className={`reader-paragraph translation ${t?.state ?? 'waiting'}`}
                data-reader-paragraph-id={paragraph.id}
              >
                {t?.state === 'error'
                  ? `翻译失败：${t.error ?? '未知错误'}`
                  : t?.state === 'done'
                    ? t.text
                    : t?.state === 'active'
                      ? t.text
                      : '等待翻译...'}
              </p>
            )
          })}
        </div>
      </div>
    </main>
  )
}

function ParagraphBlock({
  paragraph,
  translation
}: {
  paragraph: PageParagraph
  translation?: { text: string; state: ParagraphState; error?: string }
}): JSX.Element {
  return (
    <p
      className={`reader-paragraph original ${translation?.state ?? 'waiting'}`}
      data-reader-paragraph-id={paragraph.id}
    >
      {paragraph.text}
    </p>
  )
}
