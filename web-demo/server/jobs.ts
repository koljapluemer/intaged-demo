import { randomUUID } from 'node:crypto'
import type { GenerationJob, WidgetArtifact } from '../src/types.js'

const FINISHED_TTL_MS = 30 * 60_000

interface Entry {
  job: GenerationJob
  blockId: string
  finishedAt?: number
}

/**
 * Generations run independently of the HTTP request that started them, so a dropped connection,
 * a closed tab or a proxy timeout never loses work; clients poll for the result.
 */
export class GenerationJobs {
  private readonly entries = new Map<string, Entry>()

  /** Starts a job for the block, or returns the one already running for it. */
  start(blockId: string, work: (setStage: (stage: string) => void) => Promise<WidgetArtifact>): GenerationJob {
    this.expire()
    for (const entry of this.entries.values()) {
      if (entry.blockId === blockId && entry.job.status === 'running') return entry.job
    }

    const id = randomUUID()
    const entry: Entry = { blockId, job: { id, status: 'running', stage: 'Waiting to start' } }
    this.entries.set(id, entry)
    const started = Date.now()
    const setStage = (stage: string) => {
      if (entry.job.status === 'running') entry.job = { id, status: 'running', stage }
    }

    void work(setStage).then(
      (artifact) => {
        entry.job = { id, status: 'done', artifact }
        entry.finishedAt = Date.now()
        console.log(`generation ${id} for block ${blockId} done in ${Math.round((Date.now() - started) / 1000)}s`)
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        entry.job = { id, status: 'failed', error: message }
        entry.finishedAt = Date.now()
        console.error(`generation ${id} for block ${blockId} failed:`, error)
      },
    )
    return entry.job
  }

  get(id: string): GenerationJob | null {
    return this.entries.get(id)?.job ?? null
  }

  private expire() {
    const cutoff = Date.now() - FINISHED_TTL_MS
    for (const [id, entry] of this.entries) {
      if (entry.finishedAt && entry.finishedAt < cutoff) this.entries.delete(id)
    }
  }
}
