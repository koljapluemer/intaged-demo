export interface DocInfo {
  name: string
  mtime: number
}

export interface WidgetCode {
  html: string
  css: string
  js: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await res.json().catch(() => undefined)
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export const listDocs = () => request<DocInfo[]>('/api/docs')

export const getDoc = (name: string) =>
  request<{ name: string; content: string }>(`/api/docs/${encodeURIComponent(name)}`)

export const saveDoc = (name: string, content: string) =>
  request<DocInfo>(`/api/docs/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })

export const generateWidget = (spec: string, previous?: WidgetCode, errors?: string[]) =>
  request<WidgetCode>('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ spec, previous, errors }),
  })
