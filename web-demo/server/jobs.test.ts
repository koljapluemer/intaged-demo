import { describe, expect, it, vi } from 'vitest'
import type { WidgetArtifact } from '../src/types.js'
import { GenerationJobs } from './jobs.js'

const artifact = { id: 'w_x' } as WidgetArtifact

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

describe('GenerationJobs', () => {
  it('tracks stage and result of a job and reuses the running job for a block', async () => {
    const jobs = new GenerationJobs()
    const work = deferred<WidgetArtifact>()
    let setStage!: (stage: string) => void
    const job = jobs.start('block', (update) => ((setStage = update), work.promise))
    expect(jobs.start('block', vi.fn()).id).toBe(job.id)

    setStage('Drawing')
    expect(jobs.get(job.id)).toEqual({ id: job.id, status: 'running', stage: 'Drawing' })
    work.resolve(artifact)
    await work.promise
    await Promise.resolve()
    expect(jobs.get(job.id)).toEqual({ id: job.id, status: 'done', artifact })
    expect(jobs.start('block', () => new Promise(() => undefined)).id).not.toBe(job.id)
  })

  it('records failures with their message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const jobs = new GenerationJobs()
    const job = jobs.start('block', () => Promise.reject(new Error('The model request failed: boom')))
    await vi.waitFor(() => expect(jobs.get(job.id)).toMatchObject({ status: 'failed', error: 'The model request failed: boom' }))
  })
})
