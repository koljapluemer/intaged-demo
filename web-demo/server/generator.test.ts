import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { Bundler } from './bundler.js'
import { config } from './config.js'
import { rateLimitPauseMs, WidgetGenerator } from './generator.js'
import { PackageRegistry } from './packages.js'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

function toolStep(...calls: Array<[string, object]>): LanguageModelV4GenerateResult {
  return {
    content: calls.map(([toolName, input], index) => ({
      type: 'tool-call',
      toolCallId: `${toolName}-${index}-${Math.random()}`,
      toolName,
      input: JSON.stringify(input),
    })),
    finishReason: { unified: 'tool-calls', raw: undefined },
    usage,
    warnings: [],
  }
}

const giveUp: LanguageModelV4GenerateResult = {
  content: [{ type: 'text', text: 'I give up' }],
  finishReason: { unified: 'stop', raw: undefined },
  usage,
  warnings: [],
}

function dailyQuotaExceeded() {
  return new APICallError({
    message: 'You exceeded your current quota. Generate content requests per day limit exceeded on Free Tier.',
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode: 429,
    responseBody: JSON.stringify({
      error: {
        code: 429,
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
        ],
      },
    }),
  })
}

async function createGenerator(steps: LanguageModelV4GenerateResult[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'theadoc-generator-'))
  const bundler = new Bundler({
    bundles: path.join(root, 'bundles'),
    packages: path.join(root, 'packages'),
    npmCache: path.join(root, 'npm-cache'),
  })
  await bundler.initialize()
  const model = new MockLanguageModelV4({ doGenerate: steps })
  return {
    generator: new WidgetGenerator(bundler, new PackageRegistry(), {
      primary: { model, label: 'test/primary' },
    }),
    model,
  }
}

async function createRoutedGenerator(
  primarySteps: LanguageModelV4GenerateResult[],
  fallbackSteps: LanguageModelV4GenerateResult[],
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'theadoc-generator-'))
  const bundler = new Bundler({
    bundles: path.join(root, 'bundles'),
    packages: path.join(root, 'packages'),
    npmCache: path.join(root, 'npm-cache'),
  })
  await bundler.initialize()
  const primary = new MockLanguageModelV4({ doGenerate: primarySteps })
  const fallback = new MockLanguageModelV4({ doGenerate: fallbackSteps })
  return {
    generator: new WidgetGenerator(bundler, new PackageRegistry(), {
      primary: {
        model: primary,
        label: 'google/gemini-test',
        providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
      },
      fallback: {
        model: fallback,
        label: 'openrouter/fallback-test',
        providerOptions: { openrouter: { reasoning: { effort: 'low' } } },
      },
    }),
    primary,
    fallback,
  }
}

describe('WidgetGenerator', () => {
  it('delivers as soon as a final change builds cleanly, fixing build errors on the way', async () => {
    const { generator, model } = await createGenerator([
      toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const = broken' }] }]),
      toolStep(['edit_files', { edits: [{ path: 'main.ts', old_text: 'const = broken', new_text: "document.body.dataset.ok = 'yes'" }] }]),
    ])
    const stages: string[] = []
    const result = await generator.generate({ spec: 'a tiny widget', onProgress: (stage) => stages.push(stage) })

    expect(model.doGenerateCalls).toHaveLength(2)
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('main.ts:1')
    expect(result.source.files['main.ts']).toContain("dataset.ok = 'yes'")
    expect(result.bundle).toMatch(/^[0-9a-f]{64}$/)
    expect(stages).toEqual(expect.arrayContaining(['Planning', 'Drawing', 'Refining']))
  })

  it('keeps going after a clean build when more changes were announced', async () => {
    const { generator, model } = await createGenerator([
      toolStep(['write_files', { files: [{ path: 'main.ts', content: 'export {}' }], more: true }]),
      toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const done = 1' }] }]),
    ])
    const result = await generator.generate({ spec: 'two steps' })
    expect(model.doGenerateCalls).toHaveLength(2)
    expect(result.source.files['main.ts']).toBe('const done = 1')
  })

  it('sets network hosts together with the files', async () => {
    const { generator, model } = await createGenerator([
      toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const map = 1' }], network: ['tile.openstreetmap.org'] }]),
    ])
    const result = await generator.generate({ spec: 'a map' })
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(result.source.network).toEqual(['tile.openstreetmap.org'])
  })

  it('does not deliver the untouched starter entry point', async () => {
    const { generator, model } = await createGenerator([
      toolStep(['write_files', { files: [{ path: 'body.html', content: '<p>hi</p>' }] }]),
      toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const real = 1' }] }]),
    ])
    await generator.generate({ spec: 'starter' })
    expect(model.doGenerateCalls).toHaveLength(2)
  })

  it('retries once from the broken workspace with its build errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { generator, model } = await createGenerator([
      toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const = broken' }] }]),
      giveUp,
      toolStep(['edit_files', { edits: [{ path: 'main.ts', old_text: 'const = broken', new_text: 'const fixed = 1' }] }]),
    ])
    const result = await generator.generate({ spec: 'broken' })
    expect(result.source.files['main.ts']).toBe('const fixed = 1')
    expect(JSON.stringify(model.doGenerateCalls[2].prompt)).toContain('main.ts:1')
  })

  it('fails with build diagnostics when the retry is broken too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { generator } = await createGenerator([
      toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const = broken' }] }]),
      giveUp,
      giveUp,
    ])
    await expect(generator.generate({ spec: 'broken' })).rejects.toThrow(/could not be built: main\.ts:1/)
  })

  it('builds the previous version when the model changes nothing', async () => {
    const { generator, model } = await createGenerator([giveUp])
    const previous = { files: { 'body.html': '<p></p>', 'main.ts': 'console.log("previous")' }, deps: {}, network: [] }
    const result = await generator.generate({ spec: 'unchanged', previous })
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(result.source).toEqual(previous)
  })

  it('falls back once with the failed workspace and records both models', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { generator, primary, fallback } = await createRoutedGenerator(
      [toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const = broken' }] }]), giveUp],
      [toolStep(['edit_files', { edits: [{ path: 'main.ts', old_text: 'const = broken', new_text: 'const fixed = 1' }] }])],
    )

    const result = await generator.generate({ spec: 'repair with fallback' })

    expect(primary.doGenerateCalls).toHaveLength(2)
    expect(fallback.doGenerateCalls).toHaveLength(1)
    expect(JSON.stringify(fallback.doGenerateCalls[0].prompt)).toContain('main.ts:1')
    expect(primary.doGenerateCalls[0].providerOptions).toHaveProperty('google')
    expect(primary.doGenerateCalls[0].providerOptions).not.toHaveProperty('openrouter')
    expect(fallback.doGenerateCalls[0].providerOptions).toHaveProperty('openrouter')
    expect(fallback.doGenerateCalls[0].providerOptions).not.toHaveProperty('google')
    expect(result.source.files['main.ts']).toBe('const fixed = 1')
    expect(result.model).toBe('google/gemini-test -> openrouter/fallback-test')
  })

  it('does not call the fallback after a clean primary build', async () => {
    const { generator, fallback } = await createRoutedGenerator(
      [toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const done = 1' }] }])],
      [giveUp],
    )

    const result = await generator.generate({ spec: 'primary succeeds' })

    expect(fallback.doGenerateCalls).toHaveLength(0)
    expect(result.model).toBe('google/gemini-test')
  })

  it('logs a correlated summary across steps and fallback retries', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { generator } = await createRoutedGenerator(
      [toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const = broken' }] }]), giveUp],
      [toolStep(['edit_files', { edits: [{ path: 'main.ts', old_text: 'const = broken', new_text: 'const fixed = 1' }] }])],
    )

    const result = await generator.generate({ spec: 'trace this repair' })

    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    expect(new Set(events.map((event) => event.runId))).toEqual(new Set([result.runId]))
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(['generation_start', 'generation_step', 'generation_retry', 'generation_end']),
    )
    const start = events.find((event) => event.event === 'generation_start')!
    expect(start).toMatchObject({ primary: 'google/gemini-test', fallback: 'openrouter/fallback-test' })
    expect(start.settingsHash).toMatch(/^[0-9a-f]{12}$/)
    expect(start.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(start)).not.toContain('trace this repair')
    // One model_call per provider request: two on the primary, one on the fallback.
    expect(events.filter((event) => event.event === 'model_call').map((event) => event.attempt)).toEqual([1, 1, 2])
    for (const attemptEnd of events.filter((event) => event.event === 'generation_attempt_end')) {
      expect(attemptEnd.planningMs).toEqual(expect.any(Number))
    }
    expect(events.find((event) => event.event === 'generation_retry')).toMatchObject({
      from: 'google/gemini-test',
      to: 'openrouter/fallback-test',
    })
    expect(events.at(-1)).toMatchObject({ event: 'generation_end', outcome: 'ok', attempts: 2, reloops: 1 })

    const failedTool = events
      .filter((event) => event.event === 'generation_step')
      .flatMap((event) => event.tools as Array<Record<string, unknown>>)
      .find((tool) => tool.outcome === 'error')
    expect(failedTool).toMatchObject({ name: 'write_files', outcome: 'error' })
  })

  it('logs failed provider requests, including silent SDK retries', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    output.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Skip the SDK's 2s/4s retry backoff; leave every other timer (e.g. the generation timeout) alone.
    const realSetTimeout = globalThis.setTimeout
    const timers = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: () => void, ms?: number) =>
        realSetTimeout(handler, ms === 2_000 || ms === 4_000 ? 0 : ms)) as typeof setTimeout)
    const root = await mkdtemp(path.join(os.tmpdir(), 'theadoc-generator-'))
    const bundler = new Bundler({
      bundles: path.join(root, 'bundles'),
      packages: path.join(root, 'packages'),
      npmCache: path.join(root, 'npm-cache'),
    })
    await bundler.initialize()
    const unavailable = new APICallError({
      message: 'overloaded',
      url: 'https://example.test',
      requestBodyValues: {},
      statusCode: 503,
    })
    const busy = new MockLanguageModelV4({
      doGenerate: async () => {
        throw unavailable
      },
    })
    const generator = new WidgetGenerator(bundler, new PackageRegistry(), { primary: { model: busy, label: 'test/busy' } })

    await expect(generator.generate({ spec: 'busy' })).rejects.toThrow()

    const calls = output.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((event) => event.event === 'model_call')
    // Two attempts (first try plus the generator's retry), each with the SDK's 1 + 2 silent retries.
    expect(calls).toHaveLength(6)
    expect(calls[0]).toMatchObject({ ok: false, status: 503, retryable: true })
    timers.mockRestore()
  })

  it('appends run events to a daily JSONL file when a run log directory is set', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const directory = await mkdtemp(path.join(os.tmpdir(), 'theadoc-runs-'))
    const previous = config.runLogDir
    config.runLogDir = directory
    try {
      const { generator } = await createGenerator([toolStep(['write_files', { files: [{ path: 'main.ts', content: 'const ok = 1' }] }])])
      const result = await generator.generate({ spec: 'persisted' })

      const files = await readdir(directory)
      expect(files).toEqual([`${new Date().toISOString().slice(0, 10)}.jsonl`])
      const events = (await readFile(path.join(directory, files[0]), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(events[0]).toMatchObject({ event: 'generation_start', runId: result.runId })
      expect(events.at(-1)).toMatchObject({ event: 'generation_end', outcome: 'ok' })
    } finally {
      config.runLogDir = previous
    }
  })

  it('pauses a rate-limited primary and sends later runs straight to the fallback', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    output.mockClear()
    const root = await mkdtemp(path.join(os.tmpdir(), 'theadoc-generator-'))
    const bundler = new Bundler({
      bundles: path.join(root, 'bundles'),
      packages: path.join(root, 'packages'),
      npmCache: path.join(root, 'npm-cache'),
    })
    await bundler.initialize()
    const primary = new MockLanguageModelV4({
      doGenerate: async () => {
        throw dailyQuotaExceeded()
      },
    })
    const write = (content: string) => toolStep(['write_files', { files: [{ path: 'main.ts', content }] }])
    const fallback = new MockLanguageModelV4({ doGenerate: [write('const first = 1'), write('const second = 2')] })
    const generator = new WidgetGenerator(bundler, new PackageRegistry(), {
      primary: { model: primary, label: 'google/gemini-test', maxRetries: 0 },
      fallback: { model: fallback, label: 'openrouter/fallback-test' },
    })

    const first = await generator.generate({ spec: 'first' })
    const second = await generator.generate({ spec: 'second' })

    // maxRetries 0: one request, no silent SDK retries; the second run never touches the primary.
    expect(primary.doGenerateCalls).toHaveLength(1)
    expect(first.model).toBe('google/gemini-test -> openrouter/fallback-test')
    expect(second.model).toBe('openrouter/fallback-test')
    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    expect(events.find((event) => event.event === 'route_paused')).toMatchObject({ model: 'google/gemini-test', pauseMs: 3_600_000 })
    expect(events.find((event) => event.event === 'route_skipped')).toMatchObject({ model: 'google/gemini-test', runId: second.runId })
  })

  it('derives the rate-limit pause from the quota error', () => {
    expect(rateLimitPauseMs(dailyQuotaExceeded())).toBe(3_600_000)
    const perMinute = (body?: string) =>
      new APICallError({ message: 'Resource exhausted', url: 'u', requestBodyValues: {}, statusCode: 429, responseBody: body })
    expect(rateLimitPauseMs(perMinute('{"error":{"details":[{"retryDelay": "37.5s"}]}}'))).toBe(37_500)
    expect(rateLimitPauseMs(perMinute())).toBe(60_000)
    expect(rateLimitPauseMs(new APICallError({ message: 'overloaded', url: 'u', requestBodyValues: {}, statusCode: 503 }))).toBeNull()
    expect(rateLimitPauseMs(new Error('nope'))).toBeNull()
  })

  it('does not call the fallback after caller cancellation', async () => {
    const { generator, fallback } = await createRoutedGenerator([giveUp], [giveUp])
    const controller = new AbortController()
    controller.abort()

    await expect(generator.generate({ spec: 'cancelled', signal: controller.signal })).rejects.toThrow()
    expect(fallback.doGenerateCalls).toHaveLength(0)
  })
})
