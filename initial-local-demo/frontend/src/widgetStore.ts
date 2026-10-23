import type { WidgetCode } from './api'

// Generated code lives only in this browser; the spec itself lives in the document.
const PREFIX = 'intaged:'

// cyrb53: small, fast, synchronous string hash — good enough for cache keys.
export function hashSpec(spec: string): string {
  const str = spec.trim()
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // storage full or unavailable: the widget just won't persist
  }
}

export function loadWidget(hash: string): WidgetCode | null {
  return read<WidgetCode>(`code:${hash}`)
}

export function saveWidget(hash: string, code: WidgetCode) {
  write(`code:${hash}`, code)
}

// Which spec hash a block slot (doc + block index) last showed, so an edited
// spec can still show its previous widget as "stale" after a reload.
export function loadLastHash(slot: string): string | null {
  return read<string>(`last:${slot}`)
}

export function saveLastHash(slot: string, hash: string) {
  write(`last:${slot}`, hash)
}
