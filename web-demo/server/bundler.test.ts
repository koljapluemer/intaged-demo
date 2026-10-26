import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WidgetSource } from '../src/types.js'
import { Bundler } from './bundler.js'

async function createBundler() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'theadoc-bundler-'))
  const bundler = new Bundler({
    bundles: path.join(root, 'bundles'),
    packages: path.join(root, 'packages'),
    npmCache: path.join(root, 'npm-cache'),
  })
  await bundler.initialize()
  return bundler
}

const source = (files: Record<string, string>, deps: Record<string, string> = {}): WidgetSource => ({
  files: { 'body.html': '<div id="app"></div>', ...files },
  deps,
  network: [],
})

describe('Bundler', () => {
  it('bundles TypeScript and CSS into a stable, content-addressed bundle', async () => {
    const bundler = await createBundler()
    const widget = source({
      'style.css': '#app { color: red }',
      'main.ts': "import { label } from './label.ts'\ndocument.getElementById('app')!.textContent = label(2)",
      'label.ts': 'export const label = (n: number): string => `value ${n}`',
    })
    const first = await bundler.build(widget)
    const second = await bundler.build(widget)
    expect(first.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.hash).toBe(first.hash)
    const bundle = JSON.parse((await bundler.getBundle(first.hash))!)
    expect(bundle.js).toContain('value ')
    expect(bundle.css).toContain('red')
  })

  it('reports file and line for syntax errors', async () => {
    const bundler = await createBundler()
    const result = await bundler.build(source({ 'main.ts': 'const a = 1\nconst = 2' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]).toMatch(/^main\.ts:2:\d+: /)
  })

  it('hints at add_dependency for missing packages and blocks Node built-ins', async () => {
    const bundler = await createBundler()
    const result = await bundler.build(source({ 'main.ts': "import 'left-pad'\nimport 'node:fs'" }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.join('\n')).toContain('add_dependency')
    expect(result.diagnostics.join('\n')).toContain('Node built-in')
  })

  it('refuses imports outside the workspace', async () => {
    const bundler = await createBundler()
    const target = path.resolve('package.json')
    const result = await bundler.build(source({ 'main.ts': `import data from '${target}'\nconsole.log(data)` }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.join('\n')).toContain('outside the widget workspace')
  })

  it('rejects unknown bundle hashes', async () => {
    const bundler = await createBundler()
    await expect(bundler.getBundle('../../etc/passwd')).resolves.toBeNull()
    await expect(bundler.getBundle('f'.repeat(64))).resolves.toBeNull()
  })

  it.skipIf(!process.env.NETWORK_TESTS)(
    'installs npm dependencies without running scripts',
    async () => {
      const bundler = await createBundler()
      const result = await bundler.build(
        source({ 'main.ts': "import { nanoid } from 'nanoid'\nconsole.log(nanoid())" }, { nanoid: '5.1.6' }),
      )
      expect(result).toMatchObject({ ok: true })
    },
    120_000,
  )
})
