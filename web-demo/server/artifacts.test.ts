import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactStore } from './artifacts.js'

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'theadoc-artifacts-'))
  const store = new ArtifactStore(directory)
  await store.initialize()
  return { directory, store }
}

describe('ArtifactStore', () => {
  it('round trips an immutable artifact without temporary files', async () => {
    const { directory, store } = await createStore()
    const saved = await store.save(
      {
        documentId: 'doc',
        blockId: crypto.randomUUID(),
        spec: 'a chart',
        specHash: 'hash',
        model: 'model',
        generatorVersion: 'v2',
      },
      { files: { 'main.ts': 'console.log(1)' }, deps: { 'chart.js': '4.5.1' }, network: [] },
      'a'.repeat(64),
    )
    expect(saved.schemaVersion).toBe(2)
    await expect(store.get(saved.id)).resolves.toEqual(saved)
    expect(await readdir(directory)).toEqual([`${saved.id}.json`])
  })

  it('treats legacy v1 artifacts as missing', async () => {
    const { directory, store } = await createStore()
    const id = `w_${crypto.randomUUID()}`
    await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ id, html: '', css: '', js: '', libs: ['d3'] }))
    await expect(store.get(id)).resolves.toBeNull()
  })

  it('rejects invalid paths', async () => {
    const { store } = await createStore()
    await expect(store.get('../secret')).resolves.toBeNull()
  })
})
