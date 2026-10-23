const KEY = 'theadoc:recent-documents'

export interface RecentDocument {
  id: string
  title: string
  openedAt: number
}

export function readRecentDocuments(): RecentDocument[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? value.slice(0, 30) : []
  } catch {
    return []
  }
}

export function rememberDocument(document: RecentDocument) {
  const recent = readRecentDocuments().filter((item) => item.id !== document.id)
  localStorage.setItem(KEY, JSON.stringify([document, ...recent].slice(0, 30)))
}
