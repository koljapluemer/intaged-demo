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
  it('runs the tool loop until a built workspace is finished', async () => {
    const { generator, model } = await createGenerator([
      toolStep(['write_file', { path: 'main.ts', content: 'const = broken' }], ['build', {}]),
      toolStep(['finish', { summary: 'premature' }]),
      toolStep(['edit_file', { path: 'main.ts', old_text: 'const = broken', new_text: "document.body.dataset.ok = 'yes'" }], ['build', {}]),
      toolStep(['finish', { summary: 'A tiny widget' }]),
    ])
    const stages: string[] = []
    const result = await generator.generate({ spec: 'a tiny widget', onProgress: (stage) => stages.push(stage) })

    expect(model.doGenerateCalls).toHaveLength(4)
    expect(result.source.files['main.ts']).toContain("dataset.ok = 'yes'")
    expect(result.bundle).toMatch(/^[0-9a-f]{64}$/)
    expect(stages).toEqual(expect.arrayContaining(['Planning', 'Drawing', 'Checking', 'Finishing touches']))
  })

  it('retries once from the broken workspace with its build errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { generator, model } = await createGenerator([
      toolStep(['write_file', { path: 'main.ts', content: 'const = broken' }], ['build', {}]),
      giveUp,
      toolStep(['edit_file', { path: 'main.ts', old_text: 'const = broken', new_text: 'const fixed = 1' }], ['build', {}]),
      toolStep(['finish', { summary: 'fixed' }]),
    ])
    const result = await generator.generate({ spec: 'broken' })
    expect(result.source.files['main.ts']).toBe('const fixed = 1')
    expect(JSON.stringify(model.doGenerateCalls[2].prompt)).toContain('main.ts:1')
  })

  it('fails with build diagnostics when the retry is broken too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { generator } = await createGenerator([
      toolStep(['write_file', { path: 'main.ts', content: 'const = broken' }], ['build', {}]),
      giveUp,
      toolStep(['build', {}]),
      giveUp,
    ])
    await expect(generator.generate({ spec: 'broken' })).rejects.toThrow(/could not be built: main\.ts:1/)
  })

  it('seeds the workspace from the previous version', async () => {
    const { generator } = await createGenerator([toolStep(['build', {}]), toolStep(['finish', { summary: 'same' }])])
    const previous = { files: { 'body.html': '<p></p>', 'main.ts': 'console.log("previous")' }, deps: {}, network: [] }
    const result = await generator.generate({ spec: 'unchanged', previous })
    expect(result.source).toEqual(previous)
  })
})
