import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ArrowLeft, Languages } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { consumeLastError, safePostPort } from '../shared/ports'
import { savePageContext } from '../shared/storage'
import type { PageContext, PageParagraph, TranslationEvent } from '../shared/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

type PageData = {
  pageNumber: number
  paragraphs: PageParagraph[]
  文本: string
}

type ParagraphState = 'pending' | 'active' | 'done' | 'error'

type TranslationMap = {
  [paragraphId: string]: { text: string; state: ParagraphState; error?: string }
}

export function App(): JSX.Element {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [status, setStatus] = useState('正在加载 PDF...')
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<PageData[]>([])
  const [numPages, setNumPages] = useState(0)
  const [translating, setTranslating] = useState(false)
  const [translations, setTranslations] = useState<TranslationMap>({})
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const url = params.get('url')
    if (!url) {
      setError('缺少 PDF URL 参数')
      setStatus('')
      return
    }
    setPdfUrl(url)
    void loadPdf(url)
    return () => {
      abortTranslation()
    }
  }, [])

  async function loadPdf(url: string): Promise<void> {
    setStatus('正在获取 PDF...')
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`获取 PDF 失败：${response.status}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      setStatus('正在解析 PDF...')

      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      pdfDocRef.current = doc
      setNumPages(doc.numPages)

      const loaded: PageData[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const textContent = await page.getTextContent()
        const text = extractPageText(textContent as { items: Array<{ str: string; transform: number[] }> })
        const paragraphs = splitParagraphs(text, i)

        loaded.push({
          pageNumber: i,
          paragraphs,
          文本: text
        })
      }

      setPages(loaded)
      setStatus(`共 ${doc.numPages} 页`)

      // Save context so the side panel can access it for Q&A
      const allParagraphs = loaded.flatMap((p) => p.paragraphs)
      void savePageContext({
        title: url.split('/').pop() || 'PDF 文档',
        url,
        excerpt: allParagraphs.slice(0, 3).map((p) => p.text).join('\n'),
        paragraphs: allParagraphs,
        capturedAt: Date.now()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus('')
    }
  }

  // Render canvases when pages are loaded
  useEffect(() => {
    if (pages.length === 0 || !pdfDocRef.current) return

    const doc = pdfDocRef.current
    for (const pageData of pages) {
      const canvas = document.querySelector<HTMLCanvasElement>(
        `canvas[data-page="${pageData.pageNumber}"]`
      )
      if (!canvas || canvas.hasAttribute('data-rendered')) continue
      void renderCanvas(doc, pageData.pageNumber, canvas)
    }
  }, [pages])

  // Scroll sync: when left PDF pages scroll into view, scroll right panel
  useEffect(() => {
    if (pages.length === 0) return

    const leftPages = document.querySelectorAll<HTMLElement>('.pdf-page[data-pdf-page]')
    if (leftPages.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible) return

        const pageNumber = (visible.target as HTMLElement).dataset.pdfPage
        if (!pageNumber) return

        const rightPage = document.querySelector<HTMLElement>(
          `.pdf-translation-page[data-pdf-page="${pageNumber}"]`
        )
        rightPage?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      },
      { threshold: [0.1, 0.3, 0.5] }
    )

    for (const page of leftPages) {
      observer.observe(page)
    }

    return () => observer.disconnect()
  }, [pages, translations])

  async function renderCanvas(
    doc: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    canvas: HTMLCanvasElement
  ): Promise<void> {
    try {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1.5 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = '100%'
      canvas.style.height = 'auto'

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      await page.render({ canvas, viewport }).promise
      canvas.setAttribute('data-rendered', 'true')
    } catch {
      canvas.textContent = '渲染失败'
    }
  }

  // ---- translation (lazy: visible pages first, scroll triggers more) ----

  const queuedRef = useRef<Set<string>>(new Set())
  const completedRef = useRef(0)
  const translatingRef = useRef(false)

  function startTranslation(): void {
    if (pages.length === 0 || translatingRef.current) return

    translatingRef.current = true
    setTranslating(true)

    const allParagraphs = pages.flatMap((page) => page.paragraphs)
    const total = allParagraphs.length
    queuedRef.current = new Set()
    completedRef.current = 0

    const initial: TranslationMap = {}
    for (const p of allParagraphs) {
      initial[p.id] = { text: '', state: 'pending' }
    }
    setTranslations(initial)
    setStatus(`准备翻译 ${total} 段，优先翻译当前页面`)

    const port = chrome.runtime.connect({ name: 'translation' })
    portRef.current = port

    const translateVisible = () => {
      const visibleParagraphs = getVisiblePageParagraphs()
      const newParagraphs = visibleParagraphs.filter((p) => !queuedRef.current.has(p.id))
      if (newParagraphs.length === 0) return

      for (const p of newParagraphs) queuedRef.current.add(p.id)

      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId

      port.onMessage.addListener(function handler(event: TranslationEvent) {
        if (event.requestId !== requestId) return

        if (event.type === 'batch') {
          for (const t of event.translations) {
            if (t.id === '__progress__') continue
            completedRef.current += 1
            setTranslations((current) => {
              const entry = current[t.id]
              if (!entry) return current
              return { ...current, [t.id]: { ...entry, text: t.text, state: 'done' as ParagraphState } }
            })
          }
          setStatus(`已翻译 ${completedRef.current}/${total} 段`)
          return
        }

        if (event.type === 'done') {
          port.onMessage.removeListener(handler)
          if (completedRef.current >= total) {
            setStatus(`翻译完成 · ${total} 段`)
            setTranslating(false)
            translatingRef.current = false
          } else {
            setStatus(`已翻译 ${completedRef.current}/${total} 段，滚动继续翻译`)
          }
          return
        }

        if (event.type === 'error') {
          setStatus(event.message)
        }
      })

      safePostPort(port, {
        type: 'translate-batch',
        requestId,
        paragraphs: newParagraphs,
        targetLang: 'zh-CN',
        url: pdfUrl ?? undefined
      })
    }

    // Set up scroll observer for lazy translation
    const bodyEl = document.getElementById('pdf-body')
    if (bodyEl) {
      const scrollObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            translateVisible()
          }
        },
        { root: bodyEl, rootMargin: '400px 0px', threshold: 0 }
      )

      for (const rowEl of document.querySelectorAll('.pdf-row[data-pdf-page]')) {
        scrollObserver.observe(rowEl)
      }

      port.onDisconnect.addListener(() => {
        consumeLastError()
        scrollObserver.disconnect()
        portRef.current = null
        if (translatingRef.current) {
          setStatus('连接已断开')
          setTranslating(false)
          translatingRef.current = false
        }
      })
    }

    // Translate immediately visible pages
    translateVisible()
  }

  function getVisiblePageParagraphs(): PageParagraph[] {
    const bodyEl = document.getElementById('pdf-body')
    if (!bodyEl) return pages.flatMap((p) => p.paragraphs)

    const visiblePages = new Set<number>()
    for (const rowEl of document.querySelectorAll<HTMLElement>('.pdf-row[data-pdf-page]')) {
      const rect = rowEl.getBoundingClientRect()
      const containerRect = bodyEl.getBoundingClientRect()
      if (rect.bottom >= containerRect.top - 400 && rect.top <= containerRect.bottom + 400) {
        visiblePages.add(Number(rowEl.dataset.pdfPage))
      }
    }

    if (visiblePages.size === 0) {
      visiblePages.add(pages[0]?.pageNumber ?? 1)
    }

    return pages
      .filter((page) => visiblePages.has(page.pageNumber))
      .flatMap((page) => page.paragraphs)
  }

  function abortTranslation(): void {
    portRef.current?.disconnect()
    portRef.current = null
    requestIdRef.current = null
  }

  function stopTranslation(): void {
    abortTranslation()
    setTranslating(false)
    translatingRef.current = false
    setStatus('翻译已停止')
  }

  function handleClose(): void {
    window.close()
  }


  // ---- render ----

  if (error) {
    return (
      <main className="pdf-reader">
        <header className="pdf-header">
          <div className="pdf-brand">
            <img className="logo-mark" src="/icons/icon_48.png" alt="" />
            <span>格物 PDF 阅读</span>
          </div>
          <button className="pdf-btn secondary" type="button" onClick={handleClose}>
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>
        </header>
        <div className="pdf-empty">{error}</div>
      </main>
    )
  }

  return (
    <main className="pdf-reader">
      <header className="pdf-header">
        <div className="pdf-brand">
          <img className="logo-mark" src="/icons/icon_48.png" alt="" />
          <div>
            <h1>PDF 阅读</h1>
            {pdfUrl && (
              <p className="pdf-source">{decodeURIComponent(pdfUrl)}</p>
            )}
          </div>
        </div>

        <div className="pdf-actions">
          {translating ? (
            <button className="pdf-btn primary" type="button" onClick={stopTranslation}>
              停止翻译
            </button>
          ) : pages.length > 0 ? (
            <button className="pdf-btn primary" type="button" onClick={startTranslation}>
              <Languages size={18} />
              <span>翻译</span>
            </button>
          ) : null}
          <button className="pdf-btn secondary" type="button" onClick={handleClose}>
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>
        </div>
      </header>

      <div className="pdf-status" data-active={translating || status.includes('正在')}>
        {status}
        {numPages > 0 && (
          <span className="pdf-page-indicator"> · {numPages} 页</span>
        )}
      </div>

      {pages.length === 0 ? (
        <div className="pdf-empty">{status}</div>
      ) : (
        <div className="pdf-body" id="pdf-body">
          {pages.map((page) => {
            const doneCount = page.paragraphs.filter(
              (p) => translations[p.id]?.state === 'done'
            ).length
            const totalCount = page.paragraphs.length
            const pageDone = doneCount === totalCount && totalCount > 0
            const allDone = page.paragraphs.every(
              (p) => translations[p.id]?.state === 'done'
            )
            const hasContent = page.paragraphs.some(
              (p) => translations[p.id]?.text
            )

            return (
              <div key={page.pageNumber} className="pdf-row" data-pdf-page={page.pageNumber}>
                <div className="pdf-row-label">
                  <span>第 {page.pageNumber} 页</span>
                  {translating && totalCount > 0 && (
                    <span className={`pdf-page-progress ${pageDone ? 'done' : ''}`}>
                      {pageDone ? '✓' : `${doneCount}/${totalCount}`}
                    </span>
                  )}
                </div>
                <div className="pdf-row-columns">
                  {/* PDF */}
                  <div className="pdf-row-canvas">
                    <canvas
                      data-page={page.pageNumber}
                      className="pdf-canvas"
                    />
                  </div>
                  {/* 译文 */}
                  <div className="pdf-row-translation">
                    {allDone && <span className="pdf-done-mark">✓</span>}
                    {page.paragraphs.map((p) => {
                      const t = translations[p.id]
                      return (
                        <p
                          key={p.id}
                          className={`pdf-paragraph translation ${t?.state ?? 'waiting'}`}
                        >
                          {t?.state === 'error'
                            ? `⚠ ${t.error ?? '翻译失败'}`
                            : t?.state === 'done'
                              ? t.text
                              : t?.state === 'active'
                                ? t.text
                                : hasContent
                                  ? '...'
                                  : ''}
                        </p>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

// ---- pdf text extraction ----

function extractPageText(textContent: { items: Array<{ str: string; transform: number[] }> }): string {
  const { items } = textContent

  if (items.length === 0) return ''

  // Sort by y position (top to bottom), then x (left to right)
  const sorted = [...items].sort((a, b) => {
    const yA = a.transform[5]
    const yB = b.transform[5]
    if (Math.abs(yA - yB) > 4) return yB - yA
    return a.transform[4] - b.transform[4]
  })

  const lines: string[][] = []
  let currentLine: string[] = [sorted[0].str]
  let currentY = sorted[0].transform[5]

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]
    if (Math.abs(item.transform[5] - currentY) > 4) {
      lines.push(currentLine)
      currentLine = [item.str]
      currentY = item.transform[5]
    } else {
      currentLine.push(item.str)
    }
  }
  lines.push(currentLine)

  return lines.map((tokens) => tokens.join(' ').trim()).filter(Boolean).join('\n')
}

function splitParagraphs(text: string, pageNumber: number): PageParagraph[] {
  return text
    .split(/\n{2,}|\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 40)
    .map((part, index) => ({
      id: `pdf-p${pageNumber}-${index + 1}`,
      text: part
    }))
}
