import { mkdtemp, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactStore } from './artifacts.js'

describe('ArtifactStore', () => {
  it('round trips an immutable artifact without temporary files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'theadoc-artifacts-'))
    const store = new ArtifactStore(directory)
    await store.initialize()
    const saved = await store.save(
      {
        documentId: 'doc',
        blockId: crypto.randomUUID(),
        spec: 'a chart',
        specHash: 'hash',
        model: 'model',
        generatorVersion: 'v1',
      },
      { html: '<canvas></canvas>', css: '', js: '', libs: ['chartjs'] },
    )
    await expect(store.get(saved.id)).resolves.toEqual(saved)
    expect(await readdir(directory)).toEqual([`${saved.id}.json`])
  })

  it('rejects invalid paths', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'theadoc-artifacts-'))
    const store = new ArtifactStore(directory)
    await store.initialize()
    await expect(store.get('../secret')).resolves.toBeNull()
  })
})
