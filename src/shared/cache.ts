import type { PageParagraph } from './types'

const DB_NAME = 'gewu-cache'
const DB_VERSION = 1
const STORE_NAME = 'translations'
const MAX_ENTRIES = 200
const MAX_AGE_DAYS = 30

type CacheRecord = {
  id: string // content hash
  url: string
  translations: Array<{ paragraphId: string; text: string }>
  cachedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('cachedAt', 'cachedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Derive a stable content hash from the URL and paragraph texts.
 */
function contentHash(url: string, paragraphs: PageParagraph[]): string {
  const payload = `${url}::${paragraphs.map((p) => `${p.id}:${p.text}`).join('|')}`
  return simpleHash(payload)
}

/**
 * Look up cached translations for the given URL and paragraphs.
 * Returns a Map of paragraphId → text, or null on cache miss.
 */
export async function getCachedTranslations(
  url: string,
  paragraphs: PageParagraph[]
): Promise<Map<string, string> | null> {
  const hash = contentHash(url, paragraphs)
  const db = await openDb()
  try {
    const record = await getRecord(db, hash)
    if (!record) return null

    const ageDays = (Date.now() - record.cachedAt) / (1000 * 60 * 60 * 24)
    if (ageDays > MAX_AGE_DAYS) {
      await deleteRecord(db, hash)
      return null
    }

    return new Map(record.translations.map((t) => [t.paragraphId, t.text]))
  } finally {
    db.close()
  }
}

/**
 * Save translations to the cache.
 */
export async function saveCachedTranslations(
  url: string,
  paragraphs: PageParagraph[],
  translations: Map<string, string>
): Promise<void> {
  const hash = contentHash(url, paragraphs)
  const db = await openDb()
  try {
    const record: CacheRecord = {
      id: hash,
      url,
      translations: Array.from(translations.entries()).map(([paragraphId, text]) => ({
        paragraphId,
        text
      })),
      cachedAt: Date.now()
    }
    await putRecord(db, record)

    // Prune old entries
    await pruneCache(db)
  } finally {
    db.close()
  }
}

/**
 * Clear all cached translations.
 */
export async function clearTranslationCache(): Promise<void> {
  const db = await openDb()
  try {
    await clearStore(db)
  } finally {
    db.close()
  }
}

function getRecord(db: IDBDatabase, id: string): Promise<CacheRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)
    request.onsuccess = () => resolve(request.result as CacheRecord | undefined)
    request.onerror = () => reject(request.error)
  })
}

function putRecord(db: IDBDatabase, record: CacheRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(record)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function deleteRecord(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function pruneCache(db: IDBDatabase): Promise<void> {
  const all = await getAllRecords(db)
  if (all.length <= MAX_ENTRIES) return

  const sorted = all.sort((a, b) => b.cachedAt - a.cachedAt)
  const toDelete = sorted.slice(MAX_ENTRIES)

  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  for (const record of toDelete) {
    store.delete(record.id)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function getAllRecords(db: IDBDatabase): Promise<CacheRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as CacheRecord[])
    request.onerror = () => reject(request.error)
  })
}

function clearStore(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Simple non-cryptographic hash (djb2 variant) for content fingerprinting.
 */
function simpleHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
