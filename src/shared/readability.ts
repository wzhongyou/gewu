import { Readability } from '@mozilla/readability'
import type { PageContext, PageParagraph } from './types'

const MIN_PARAGRAPH_LENGTH = 40
const MAX_PARAGRAPHS = 80

export function extractPageContext(): PageContext {
  const documentClone = document.cloneNode(true) as Document
  const article = new Readability(documentClone).parse()
  const paragraphs = mapParagraphs(article?.textContent ?? document.body.innerText)

  return {
    title: article?.title || document.title || location.hostname,
    url: location.href,
    excerpt: article?.excerpt || paragraphs.slice(0, 3).map((item) => item.text).join('\n'),
    paragraphs,
    capturedAt: Date.now()
  }
}

export function markPageParagraphs(paragraphs: PageParagraph[]): Map<string, HTMLElement> {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('article p, main p, p, article li, main li')
  ).filter((element) => normalizeText(element.innerText).length >= MIN_PARAGRAPH_LENGTH)

  const mapped = new Map<string, HTMLElement>()
  const used = new Set<HTMLElement>()

  for (const paragraph of paragraphs) {
    const paragraphText = normalizeText(paragraph.text)
    const element = candidates.find((candidate) => {
      if (used.has(candidate)) return false
      const candidateText = normalizeText(candidate.innerText)
      return candidateText.includes(paragraphText.slice(0, 80)) || paragraphText.includes(candidateText)
    })

    if (element) {
      element.dataset.gewuParagraphId = paragraph.id
      mapped.set(paragraph.id, element)
      used.add(element)
    }
  }

  return mapped
}

function mapParagraphs(text: string): PageParagraph[] {
  return text
    .split(/\n{2,}|\r?\n/)
    .map((item) => normalizeText(item))
    .filter((item) => item.length >= MIN_PARAGRAPH_LENGTH)
    .slice(0, MAX_PARAGRAPHS)
    .map((text, index) => ({
      id: `p-${index + 1}`,
      text
    }))
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
