export function safePostPort(port: chrome.runtime.Port | null, message: unknown): boolean {
  if (!port) return false

  try {
    port.postMessage(message)
    return true
  } catch {
    return false
  }
}

export function consumeLastError(): void {
  void chrome.runtime.lastError
}
