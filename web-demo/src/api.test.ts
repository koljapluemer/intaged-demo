import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateWidget } from './api'

const input = { documentId: 'doc', blockId: 'block', spec: 'a chart' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function serve(...responses: Array<Response | Error>) {
  const fetch = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function run(promise: Promise<unknown>) {
  const settled = promise.then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.message }),
  )
  await vi.runAllTimersAsync()
  return settled
}

describe('generateWidget', () => {
  it('polls through network blips and reports stages', async () => {
    vi.useFakeTimers()
    serve(
      json(202, { id: 'j1', status: 'running', stage: 'Planning' }),
      new TypeError('Error in input stream'),
      json(502, { error: 'Bad gateway' }),
      json(200, { id: 'j1', status: 'running', stage: 'Drawing' }),
      json(200, { id: 'j1', status: 'done', artifact: { id: 'w_1' } }),
    )
    const stages: string[] = []
    const result = await run(generateWidget(input, (stage) => stages.push(stage)))
    expect(result).toEqual({ value: { id: 'w_1' } })
    expect(stages).toEqual(['Planning', 'Reconnecting', 'Reconnecting', 'Drawing'])
  })

  it('restarts a job the server forgot once, then gives a clear error', async () => {
    vi.useFakeTimers()
    serve(
      json(202, { id: 'j1', status: 'running', stage: 'Planning' }),
      json(404, { error: 'Unknown generation' }),
      json(202, { id: 'j2', status: 'running', stage: 'Planning' }),
      json(404, { error: 'Unknown generation' }),
    )
    expect(await run(generateWidget(input, () => undefined))).toEqual({
      error: 'The server restarted during generation. Please try again.',
    })
  })

  it('surfaces the server error message of a failed job', async () => {
    vi.useFakeTimers()
    serve(
      json(202, { id: 'j1', status: 'running', stage: 'Planning' }),
      json(200, { id: 'j1', status: 'failed', error: 'Demo generation budget exhausted' }),
    )
    expect(await run(generateWidget(input, () => undefined))).toEqual({ error: 'Demo generation budget exhausted' })
  })
})
