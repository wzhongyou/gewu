import type { PageParagraph, TranslationEvent } from '../shared/types'
import { consumeLastError, safePostPort } from '../shared/ports'

type EntryState = 'pending' | 'queued' | 'translating' | 'done' | 'error'

type TextEntry = {
  id: string
  element: HTMLElement
  original: string
  translated: string
  originalHtml: string
  placeholders: Placeholder[]
  state: EntryState
}

type Placeholder = {
  token: string
  html: string
}

const ROOT_ID = 'gewu-page-translator-status'
const ACTIVE_ATTR = 'data-gewu-page-translated'
const BLOCK_STATE_ATTR = 'data-gewu-translation-state'
const MIN_TEXT_LENGTH = 2
const MIN_PARAGRAPH_LENGTH = 80
const MAX_BLOCK_LENGTH = 1800
const BATCH_SIZE = 16
const MAX_CONCURRENT_BATCHES = 2
const PREFETCH_SCREENS = 5

export class PageTranslator {
  private entries: TextEntry[] = []
  private queue: TextEntry[] = []
  private port: chrome.runtime.Port | null = null
  private requestId: string | null = null
  private statusRoot: HTMLElement
  private statusText: HTMLElement
  private hideTimer: number | null = null
  private observer: IntersectionObserver | null = null
  private inFlightBatches = 0
  private completedCount = 0
  private destroyed = false
  private lastScrollY = window.scrollY
  private scrollTimer: number | null = null

  constructor(private readonly onDestroy?: () => void) {
    this.statusRoot = document.createElement('div')
    this.statusRoot.id = ROOT_ID
    this.statusText = document.createElement('span')
  }

  static mounted(): boolean {
    return document.documentElement.hasAttribute(ACTIVE_ATTR)
  }

  mount(): void {
    document.documentElement.setAttribute(ACTIVE_ATTR, 'true')
    this.entries = collectTextEntries()
    this.renderStatus()

    if (this.entries.length === 0) {
      this.setStatus('没有找到可翻译文本')
      document.documentElement.removeAttribute(ACTIVE_ATTR)
      this.hideStatusSoon()
      return
    }

    this.start()
  }

  destroy(): void {
    this.destroyed = true
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.requestId) {
      safePostPort(this.port, { type: 'abort', requestId: this.requestId })
    }
    this.port?.disconnect()
    this.observer?.disconnect()
    window.removeEventListener('scroll', this.handleScroll)
    window.removeEventListener('resize', this.handleScroll)
    if (this.scrollTimer !== null) {
      window.clearTimeout(this.scrollTimer)
      this.scrollTimer = null
    }
    for (const entry of this.entries) {
      entry.element.innerHTML = entry.originalHtml
      delete entry.element.dataset.gewuTranslationState
    }
    document.getElementById('gewu-page-translator-style')?.remove()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    this.statusRoot.remove()
    this.onDestroy?.()
  }

  private renderStatus(): void {
    const shadow = this.statusRoot.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 2147483647;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .box {
        display: inline-flex;
        align-items: center;
        gap: 11px;
        min-height: 40px;
        max-width: min(380px, calc(100vw - 32px));
        border: 1px solid rgb(15 26 54 / 10%);
        border-radius: 999px;
        padding: 8px 8px 8px 13px;
        background: rgb(255 255 255 / 82%);
        box-shadow:
          0 16px 38px rgb(15 26 54 / 14%),
          inset 0 1px 0 rgb(255 255 255 / 78%);
        color: #0f1a36;
        font-size: 13px;
        line-height: 1.4;
        backdrop-filter: blur(18px);
        transition: opacity 160ms ease, transform 160ms ease;
      }

      .box::before {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #3d5b8b;
        box-shadow: 0 0 0 5px rgb(61 91 139 / 10%);
        content: '';
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 68px;
        height: 28px;
        border: 1px solid rgb(61 91 139 / 18%);
        border-radius: 999px;
        background: rgb(61 91 139 / 8%);
        color: #3d5b8b;
        cursor: pointer;
        font: inherit;
        padding: 0 10px;
        white-space: nowrap;
      }
    `

    const pageStyle = document.createElement('style')
    pageStyle.id = 'gewu-page-translator-style'
    pageStyle.textContent = `
      [${BLOCK_STATE_ATTR}="queued"] {
        box-shadow: inset 2px 0 0 rgb(61 91 139 / 26%);
        background-image: linear-gradient(90deg, rgb(61 91 139 / 6%), transparent 52%);
      }

      [${BLOCK_STATE_ATTR}="translating"] {
        box-shadow: inset 2px 0 0 #3d5b8b;
        background-image: linear-gradient(90deg, rgb(89 159 171 / 8%), transparent 58%);
      }
    `

    const box = document.createElement('div')
    box.className = 'box'

    this.statusText.textContent = '准备翻译'

    const close = document.createElement('button')
    close.type = 'button'
    close.title = '恢复原文'
    close.textContent = '恢复原文'
    close.addEventListener('click', () => this.destroy())

    box.append(this.statusText, close)
    shadow.append(style, box)
    document.getElementById('gewu-page-translator-style')?.remove()
    document.head.append(pageStyle)
    document.documentElement.append(this.statusRoot)
  }

  private start(): void {
    this.requestId = crypto.randomUUID()
    this.port = chrome.runtime.connect({ name: 'translation' })
    this.port.onMessage.addListener((event: TranslationEvent) => this.handleEvent(event))
    this.port.onDisconnect.addListener(() => {
      consumeLastError()
      this.port = null
      if (this.destroyed || this.completedCount >= this.entries.length) return
      this.setStatus('连接已断开')
      this.hideStatusSoon()
    })

    this.setStatus(`发现 ${this.entries.length} 处文本，优先翻译当前视图`)
    this.observeVisibleEntries()
    this.enqueueInitialViewport()
    window.addEventListener('scroll', this.handleScroll, { passive: true })
    window.addEventListener('resize', this.handleScroll)
    this.flushQueue()
  }

  private handleScroll = (): void => {
    if (this.scrollTimer !== null) {
      window.clearTimeout(this.scrollTimer)
    }

    this.scrollTimer = window.setTimeout(() => {
      this.prefetchAroundViewport()
      this.scrollTimer = null
    }, 120)
  }

  private observeVisibleEntries(): void {
    this.observer = new IntersectionObserver(
      (items) => {
        for (const item of items) {
          if (!item.isIntersecting) continue
          const entry = this.entries.find((candidate) => candidate.element === item.target)
          if (entry) {
            this.enqueue(entry)
          }
        }
        this.flushQueue()
      },
      {
        rootMargin: '900px 0px',
        threshold: 0
      }
    )

    for (const entry of this.entries) {
      this.observer.observe(entry.element)
    }
  }

  private enqueueInitialViewport(): void {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const prioritized = this.entries
      .filter((entry) => {
        const rect = entry.element.getBoundingClientRect()
        return rect.bottom >= -viewportHeight && rect.top <= viewportHeight * 2
      })
      .slice(0, BATCH_SIZE * MAX_CONCURRENT_BATCHES * 2)

    for (const entry of prioritized) {
      this.enqueue(entry)
    }
  }

  private prefetchAroundViewport(): void {
    if (this.destroyed) return

    const currentScrollY = window.scrollY
    const direction: 'down' | 'up' = currentScrollY >= this.lastScrollY ? 'down' : 'up'
    this.lastScrollY = currentScrollY

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const top = direction === 'down' ? -viewportHeight : -viewportHeight * PREFETCH_SCREENS
    const bottom = direction === 'down' ? viewportHeight * PREFETCH_SCREENS : viewportHeight * 2

    const visibleRangeEntries = this.entries.filter((entry) => {
      if (entry.state !== 'pending') return false
      const rect = entry.element.getBoundingClientRect()
      return rect.bottom >= top && rect.top <= bottom
    })

    if (visibleRangeEntries.length === 0) return

    const prioritizedEntries = direction === 'down' ? [...visibleRangeEntries].reverse() : visibleRangeEntries
    for (const entry of prioritizedEntries) {
      this.enqueue(entry, 'front')
    }

    this.setStatus(`检测到快速滚动，优先翻译当前位置 · ${this.completedCount}/${this.entries.length}`)
    this.flushQueue()
  }

  private enqueue(entry: TextEntry, priority: 'front' | 'back' = 'back'): void {
    if (entry.state !== 'pending') return
    entry.state = 'queued'
    entry.element.dataset.gewuTranslationState = 'queued'
    if (priority === 'front') {
      this.queue.unshift(entry)
    } else {
      this.queue.push(entry)
    }
    this.setStatus(`发现新内容，正在翻译 · ${this.completedCount}/${this.entries.length}`)
  }

  private flushQueue(): void {
    if (!this.port || !this.requestId || this.destroyed) return

    while (this.inFlightBatches < MAX_CONCURRENT_BATCHES && this.queue.length > 0) {
      const batch = this.queue.splice(0, BATCH_SIZE)
      for (const entry of batch) {
        entry.state = 'translating'
        entry.element.dataset.gewuTranslationState = 'translating'
      }
      this.inFlightBatches += 1

      const posted = safePostPort(this.port, {
        type: 'translate-batch',
        requestId: this.requestId,
        batchId: crypto.randomUUID(),
        paragraphs: batch.map(
          (entry): PageParagraph => ({
            id: entry.id,
            text: entry.original
          })
        ),
        targetLang: 'zh-CN'
      })
      if (!posted) {
        for (const entry of batch) {
          entry.state = 'queued'
          entry.element.dataset.gewuTranslationState = 'queued'
          this.queue.unshift(entry)
        }
        this.inFlightBatches = Math.max(0, this.inFlightBatches - 1)
        this.setStatus('连接已断开')
        this.hideStatusSoon()
        return
      }
    }
  }

  private handleEvent(event: TranslationEvent): void {
    if (event.requestId !== this.requestId) return

    if (event.type === 'batch') {
      let translatedInEvent = 0
      for (const translation of event.translations) {
        if (translation.id === '__progress__') {
          continue
        }

        const entry = this.entries.find((item) => item.id === translation.id)
        if (!entry || entry.state === 'done') continue
        entry.translated = translation.text
        renderTranslatedBlock(entry)
        entry.state = 'done'
        delete entry.element.dataset.gewuTranslationState
        this.completedCount += 1
        translatedInEvent += 1
        this.observer?.unobserve(entry.element)
      }

      if (translatedInEvent > 0) {
        this.inFlightBatches = Math.max(0, this.inFlightBatches - 1)
        this.setStatus(`已翻译 ${this.completedCount}/${this.entries.length}，滚动继续翻译`)
        this.flushQueue()
      }
      return
    }

    if (event.type === 'delta') {
      const entry = this.entries.find((item) => item.id === event.paragraphId)
      if (!entry) return
      entry.translated += event.text
      renderTranslatedBlock(entry)
      this.setStatus('正在翻译页面')
      return
    }

    if (event.type === 'error') {
      this.markCurrentBatchFailed()
      this.setStatus(event.message)
      this.hideStatusSoon()
      this.flushQueue()
      return
    }

    if (!event.paragraphId && this.completedCount >= this.entries.length) {
      this.setStatus('翻译完成')
      this.hideStatusSoon()
    }
  }

  private markCurrentBatchFailed(): void {
    for (const entry of this.entries) {
      if (entry.state === 'translating') {
        entry.state = 'error'
        delete entry.element.dataset.gewuTranslationState
      }
    }
    this.inFlightBatches = Math.max(0, this.inFlightBatches - 1)
  }

  private setStatus(text: string): void {
    if (!this.statusRoot.isConnected) {
      document.documentElement.append(this.statusRoot)
    }
    this.statusText.textContent = text
  }

  private hideStatusSoon(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer)
    }

    this.hideTimer = window.setTimeout(() => {
      this.statusRoot.remove()
      this.hideTimer = null
    }, 2500)
  }
}

function collectTextEntries(): TextEntry[] {
  const root = findMainContentRoot()
  const elements = collectTranslatableBlocks(root)
  const entries: TextEntry[] = []
  for (const element of elements) {
    const prepared = prepareBlockForTranslation(element)
    if (!shouldTranslateText(prepared.text)) continue

    entries.push({
      id: `t-${entries.length + 1}`,
      element,
      original: prepared.text,
      translated: '',
      originalHtml: element.innerHTML,
      placeholders: prepared.placeholders,
      state: 'pending'
    })
  }

  return entries
}

function collectTranslatableBlocks(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      'p, li, h1, h2, h3, h4, h5, h6, figcaption, blockquote, td, th, div, section'
    )
  ).filter(isTranslatableBlockCandidate)

  return candidates.filter((element) => !hasBetterNestedCandidate(element, candidates))
}

function findMainContentRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>('#content') ??
    document.querySelector<HTMLElement>('main') ??
    document.querySelector<HTMLElement>('article') ??
    document.body
  )
}

function shouldSkipElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase()
  if (
    [
      'script',
      'style',
      'noscript',
      'textarea',
      'input',
      'select',
      'option',
      'code',
      'pre',
      'svg',
      'math'
    ].includes(tagName)
  ) {
    return true
  }

  if (element.closest(`#${ROOT_ID}, #gewu-inline-translator`)) {
    return true
  }

  const style = window.getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden'
}

function isTranslatableBlockCandidate(element: HTMLElement): boolean {
  if (shouldSkipElement(element)) return false

  const tagName = element.tagName.toLowerCase()
  const text = normalizeBlockText(element.innerText || element.textContent || '')
  if (!shouldTranslateText(text)) return false

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption', 'td', 'th'].includes(tagName)) {
    return text.length <= MAX_BLOCK_LENGTH
  }

  if (['p', 'li', 'blockquote'].includes(tagName)) {
    return text.length <= MAX_BLOCK_LENGTH
  }

  if (!['div', 'section'].includes(tagName)) {
    return false
  }

  if (text.length < MIN_PARAGRAPH_LENGTH || text.length > MAX_BLOCK_LENGTH) {
    return false
  }

  const directTextLength = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => normalize(node.textContent ?? '').length)
    .reduce((sum, length) => sum + length, 0)

  const childElementCount = Array.from(element.children).filter((child) => {
    const childText = normalize((child as HTMLElement).innerText || child.textContent || '')
    return childText.length >= MIN_TEXT_LENGTH
  }).length

  return directTextLength >= MIN_PARAGRAPH_LENGTH || childElementCount <= 3
}

function hasBetterNestedCandidate(element: HTMLElement, candidates: HTMLElement[]): boolean {
  return candidates.some((candidate) => {
    if (candidate === element || !element.contains(candidate)) return false
    return isMoreSpecificBlock(candidate, element)
  })
}

function isMoreSpecificBlock(candidate: HTMLElement, parent: HTMLElement): boolean {
  const candidateTag = candidate.tagName.toLowerCase()
  const parentTag = parent.tagName.toLowerCase()

  if (['p', 'li', 'blockquote', 'figcaption', 'td', 'th'].includes(candidateTag)) {
    return true
  }

  if (candidateTag.startsWith('h') && parentTag !== candidateTag) {
    return true
  }

  const candidateText = normalizeBlockText(candidate.innerText || candidate.textContent || '')
  const parentText = normalizeBlockText(parent.innerText || parent.textContent || '')
  return candidateText.length >= MIN_PARAGRAPH_LENGTH && candidateText.length < parentText.length * 0.85
}

function shouldTranslateText(text: string): boolean {
  const normalized = normalize(text)
  if (normalized.length < MIN_TEXT_LENGTH) return false
  if (/^[\d\s.,:;()[\]{}|/\\+-]+$/.test(normalized)) return false
  if (/^(PDF|HTML|TeX|NASA ADS|Google Scholar|Semantic Scholar)$/i.test(normalized)) return false
  return /[A-Za-z]/.test(normalized)
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeBlockText(text: string): string {
  return text
    .split('\n')
    .map((line) => normalize(line))
    .filter(Boolean)
    .join('\n')
}

function preserveEdgeWhitespace(original: string, translated: string): string {
  const prefix = original.match(/^\s*/)?.[0] ?? ''
  const suffix = original.match(/\s*$/)?.[0] ?? ''
  return `${prefix}${translated}${suffix}`
}

function prepareBlockForTranslation(element: HTMLElement): { text: string; placeholders: Placeholder[] } {
  const clone = element.cloneNode(true) as HTMLElement
  const placeholders: Placeholder[] = []
  let index = 0

  for (const node of Array.from(
    clone.querySelectorAll<HTMLElement>('a, math, code, var, kbd, samp, svg, img')
  )) {
    const token = `⟦GEWU_${index + 1}⟧`
    placeholders.push({
      token,
      html: node.outerHTML
    })
    node.replaceWith(document.createTextNode(token))
    index += 1
  }

  return {
    text: normalizeBlockText(clone.innerText || clone.textContent || ''),
    placeholders
  }
}

function renderTranslatedBlock(entry: TextEntry): void {
  const translated = preserveEdgeWhitespace(entry.original, entry.translated)
  if (entry.placeholders.length === 0) {
    entry.element.textContent = translated
    return
  }

  entry.element.replaceChildren(...createNodesWithPlaceholders(translated, entry.placeholders))
}

function createNodesWithPlaceholders(text: string, placeholders: Placeholder[]): Node[] {
  const tokens = new Map(placeholders.map((placeholder) => [placeholder.token, placeholder.html]))
  const pattern = new RegExp(`(${placeholders.map((item) => escapeRegExp(item.token)).join('|')})`, 'g')
  const nodes: Node[] = []

  for (const part of text.split(pattern)) {
    if (!part) continue
    const html = tokens.get(part)
    if (!html) {
      nodes.push(document.createTextNode(part))
      continue
    }

    const template = document.createElement('template')
    template.innerHTML = html
    nodes.push(...Array.from(template.content.childNodes).map((node) => node.cloneNode(true)))
  }

  return nodes
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
