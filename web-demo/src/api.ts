import type { GenerationJob, WidgetArtifact, WidgetBundle } from './types'

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
        if (restarted) throw new Error('The server restarted during generation. Please try again.')
        restarted = true
        onProgress('Restarting')
        job = await startGeneration(input)
        continue
      }
      // Anything else that is not a server or proxy failure is a real error.
      if (error instanceof HttpError && error.status < 500) throw error
      unreachableSince ??= Date.now()
      if (Date.now() - unreachableSince > RECONNECT_WINDOW_MS) {
        throw new Error('Lost connection to the server. Check your connection and try again.')
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
