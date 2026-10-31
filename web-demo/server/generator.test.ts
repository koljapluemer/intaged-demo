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
  return { generator: new WidgetGenerator(bundler, new PackageRegistry(), model), model }
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
})
