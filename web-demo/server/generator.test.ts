import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { Bundler } from './bundler.js'
import { WidgetGenerator } from './generator.js'
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

    await generator.generate({ spec: 'trace this repair' })

    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    expect(new Set(events.map((event) => event.runId)).size).toBe(1)
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(['generation_start', 'generation_step', 'generation_retry', 'generation_end']),
    )
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

  it('does not call the fallback after caller cancellation', async () => {
    const { generator, fallback } = await createRoutedGenerator([giveUp], [giveUp])
    const controller = new AbortController()
    controller.abort()

    await expect(generator.generate({ spec: 'cancelled', signal: controller.signal })).rejects.toThrow()
    expect(fallback.doGenerateCalls).toHaveLength(0)
  })
})
