const ENC_ALGORITHM = 'AES-GCM'
const KEY_ALGORITHM = 'PBKDF2'
const KEY_LENGTH = 256
const SALT_LENGTH = 16
const IV_LENGTH = 12
const ITERATIONS = 300_000

export type EncryptedBlob = {
  salt: string // base64
  iv: string // base64
  ciphertext: string // base64
}

/**
 * Encrypt a plaintext string. The encryption key is derived from the extension
 * ID + random salt, so no user passphrase is required. The key is re-derived
 * on read, making the stored ciphertext unusable outside this extension.
 */
export async function encryptApiKey(plaintext: string): Promise<EncryptedBlob> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await deriveKey(salt)
  const iv = randomBytes(IV_LENGTH)

  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: ENC_ALGORITHM, iv },
    key,
    encoded
  )

  return {
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(new Uint8Array(ciphertext))
  }
}

/**
 * Decrypt an EncryptedBlob back to the original plaintext.
 */
export async function decryptApiKey(blob: EncryptedBlob): Promise<string> {
  const salt = base64ToBuffer(blob.salt)
  const iv = base64ToBuffer(blob.iv)
  const ciphertext = base64ToBuffer(blob.ciphertext)

  const key = await deriveKey(salt)
  const plaintext = await crypto.subtle.decrypt(
    { name: ENC_ALGORITHM, iv },
    key,
    ciphertext
  )

  return new TextDecoder().decode(plaintext)
}

/**
 * Check whether the stored apiKey field is an encrypted blob or plaintext.
 */
export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.salt === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.ciphertext === 'string'
  )
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length)) as Uint8Array<ArrayBuffer>
}

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(chrome.runtime.id),
    KEY_ALGORITHM,
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    { name: KEY_ALGORITHM, salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: ENC_ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

function bufferToBase64(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
}

function base64ToBuffer(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}
