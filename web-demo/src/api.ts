import { t } from './i18n'
import type { GenerationJob, TheadocDocument, WidgetArtifact, WidgetBundle } from './types'

export interface GenerateWidgetInput {
  documentId: string
  blockId: string
  spec: string
  previousRevision?: string
  errors?: string[]
}

const POLL_INTERVAL_MS = 1_000
// How long the server may be unreachable before a generation is reported as lost.
const RECONNECT_WINDOW_MS = 60_000

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await response.json().catch(() => undefined)
  if (!response.ok) throw new HttpError(data?.error ?? `${response.status} ${response.statusText}`, response.status)
  return data as T
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const startGeneration = (input: GenerateWidgetInput) =>
  request<GenerationJob>('/api/widgets/generate', { method: 'POST', body: JSON.stringify(input) })

/**
 * Starts a server-side generation and polls it to completion. Network blips are retried, and a job
 * the server no longer knows about (it restarted) is started again once.
 */
export async function generateWidget(input: GenerateWidgetInput, onProgress: (stage: string) => void) {
  let job = await startGeneration(input)
  let restarted = false
  let unreachableSince: number | null = null

  for (;;) {
    if (job.status === 'done') return job.artifact
    if (job.status === 'failed') throw new Error(job.error)
    if (unreachableSince === null) onProgress(job.stage)
    await wait(POLL_INTERVAL_MS)
    try {
      job = await request<GenerationJob>(`/api/generations/${job.id}`)
      unreachableSince = null
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        if (restarted) throw new Error(t('widget.serverRestarted'))
        restarted = true
        onProgress('Restarting')
        job = await startGeneration(input)
        continue
      }
      // Anything else that is not a server or proxy failure is a real error.
      if (error instanceof HttpError && error.status < 500) throw error
      unreachableSince ??= Date.now()
      if (Date.now() - unreachableSince > RECONNECT_WINDOW_MS) {
        throw new Error(t('widget.connectionLost'))
      }
      onProgress('Reconnecting')
    }
  }
}

export const getWidget = (revision: string) => request<WidgetArtifact>(`/api/widgets/${revision}`)

export const getBundle = (hash: string) => request<WidgetBundle>(`/api/bundles/${hash}`)

export const registerDocument = (documentId: string, token: string) =>
  request<void>('/api/documents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentId }),
  })

export type ShareAccess = 'spec' | 'reader'

export interface SharedDocument {
  access: ShareAccess
  document: TheadocDocument
}

export const createShare = (documentId: string, access: ShareAccess) =>
  request<{ token: string }>('/api/shares', { method: 'POST', body: JSON.stringify({ documentId, access }) }).then(
    (result) => result.token,
  )

export const fetchShared = (token: string) => request<SharedDocument>(`/api/shared/${encodeURIComponent(token)}`)

/** Streams updates of a shared document; the browser reconnects on its own. Returns a function that stops it. */
export function subscribeShared(token: string, onUpdate: (shared: SharedDocument) => void): () => void {
  const source = new EventSource(`/api/shared/${encodeURIComponent(token)}/events`)
  source.onmessage = (event) => onUpdate(JSON.parse(event.data) as SharedDocument)
  return () => source.close()
}
