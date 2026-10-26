import type { WidgetArtifact } from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`)
  return data as T
}

export interface GenerateWidgetInput {
  documentId: string
  blockId: string
  spec: string
  previousRevision?: string
  errors?: string[]
}

export const generateWidget = (input: GenerateWidgetInput) =>
  request<WidgetArtifact>('/api/widgets/generate', {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const getWidget = (revision: string) => request<WidgetArtifact>(`/api/widgets/${revision}`)
