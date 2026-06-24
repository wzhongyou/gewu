import overlayCss from './styles.css?inline'
import type { PageParagraph, TranslationEvent } from '../shared/types'
import { consumeLastError, safePostPort } from '../shared/ports'

const ROOT_ID = 'gewu-inline-translator'
const PAGE_CLASS = 'gewu-page-shifted'
const PANEL_WIDTH = 'min(42vw, 620px)'

export class InlineTranslator {
  private root: HTMLElement
  private shadow: ShadowRoot
  private status: HTMLElement
  private body: HTMLElement
  private paragraphNodes = new Map<string, HTMLElement>()
  private port: chrome.runtime.Port | null = null
  private requestId: string | null = null
  private previousPaddingRight = ''
  private observer: IntersectionObserver | null = null

  constructor(
    private readonly paragraphs: PageParagraph[],
    private readonly paragraphElements: Map<string, HTMLElement>
  ) {
    this.root = document.createElement('div')
    this.root.id = ROOT_ID
    this.shadow = this.root.attachShadow({ mode: 'open' })
    this.status = document.createElement('div')
    this.body = document.createElement('div')
  }

  static mounted(): boolean {
    return Boolean(document.getElementById(ROOT_ID))
  }

  mount(): void {
    document.documentElement.appendChild(this.root)
    this.previousPaddingRight = document.body.style.paddingRight
    document.body.style.paddingRight = PANEL_WIDTH
    document.body.classList.add(PAGE_CLASS)

    this.renderShell()
    this.bindScrollSync()
    this.start()
  }

  destroy(): void {
    if (this.requestId) {
      safePostPort(this.port, { type: 'abort', requestId: this.requestId })
    }
    this.port?.disconnect()
    this.observer?.disconnect()
    document.body.style.paddingRight = this.previousPaddingRight
    document.body.classList.remove(PAGE_CLASS)
    for (const element of this.paragraphElements.values()) {
      delete element.dataset.gewuParagraphId
    }
    this.root.remove()
  }

  private renderShell(): void {
    const style = document.createElement('style')
    style.textContent = overlayCss

    const panel = document.createElement('aside')
    panel.className = 'panel'

    const header = document.createElement('header')
    header.className = 'header'

    const title = document.createElement('div')
    title.className = 'title'

    const mark = document.createElement('img')
    mark.className = 'logo-mark'
    mark.alt = ''
    mark.src = chrome.runtime.getURL('icons/icon_48.png')

    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = '格物翻译'

    this.status.className = 'status'
    this.status.textContent = '准备翻译'

    title.append(mark, name, this.status)

    const close = document.createElement('button')
    close.className = 'button'
    close.type = 'button'
    close.title = '关闭'
    close.textContent = '×'
    close.addEventListener('click', () => this.destroy())

    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(close)

    this.body.className = 'body'

    if (this.paragraphs.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '没有提取到可翻译的正文。'
      this.body.append(empty)
    } else {
      for (const paragraph of this.paragraphs) {
        const node = document.createElement('section')
        node.className = 'paragraph'
        node.dataset.paragraphId = paragraph.id
        node.dataset.state = 'pending'
        node.textContent = '等待翻译...'
        this.paragraphNodes.set(paragraph.id, node)
        this.body.append(node)
      }
    }

    header.append(title, actions)
    panel.append(header, this.body)
    this.shadow.append(style, panel)
  }

  private start(): void {
    if (this.paragraphs.length === 0) return

    this.requestId = crypto.randomUUID()
    this.port = chrome.runtime.connect({ name: 'translation' })
    this.port.onMessage.addListener((event: TranslationEvent) => this.handleTranslationEvent(event))
    this.port.onDisconnect.addListener(() => {
      consumeLastError()
      this.port = null
      this.status.textContent = '连接已断开'
    })

    this.status.textContent = `正在翻译 ${this.paragraphs.length} 段`
    safePostPort(this.port, {
      type: 'translate',
      requestId: this.requestId,
      paragraphs: this.paragraphs,
      targetLang: 'zh-CN'
    })
  }

  private handleTranslationEvent(event: TranslationEvent): void {
    if (event.requestId !== this.requestId) return

    if (event.type === 'delta') {
      const node = this.paragraphNodes.get(event.paragraphId)
      if (!node) return
      if (node.dataset.state === 'pending') {
        node.textContent = ''
      }
      node.dataset.state = 'active'
      node.textContent += event.text
      this.status.textContent = '正在接收译文'
      return
    }

    if (event.type === 'done') {
      if (event.paragraphId) {
        const node = this.paragraphNodes.get(event.paragraphId)
        if (node) node.dataset.state = 'done'
        return
      }
      this.status.textContent = '翻译完成'
      return
    }

    if (event.type === 'batch') {
      return
    }

    const target = event.paragraphId ? this.paragraphNodes.get(event.paragraphId) : null
    if (target) {
      target.dataset.state = 'error'
      target.textContent = event.message
    }
    this.status.textContent = event.message
  }

  private bindScrollSync(): void {
    const entries = Array.from(this.paragraphElements.entries())
    if (entries.length === 0) return

    this.observer = new IntersectionObserver(
      (items) => {
        const visible = items
          .filter((item) => item.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const id = (visible?.target as HTMLElement | undefined)?.dataset.gewuParagraphId
        if (!id) return
        this.paragraphNodes.get(id)?.scrollIntoView({ block: 'nearest' })
      },
      { threshold: [0.2, 0.5, 0.8] }
    )

    for (const [, element] of entries) {
      this.observer.observe(element)
    }
  }
}
