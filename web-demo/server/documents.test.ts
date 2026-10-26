import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DocumentRegistry } from './documents.js'

async function createRegistry() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'theadoc-documents-'))
  const file = path.join(directory, 'documents.json')
  const registry = new DocumentRegistry(file)
  await registry.initialize()
  return { file, registry }
}

describe('DocumentRegistry', () => {
  it('starts empty without a file', async () => {
    const { registry } = await createRegistry()
    expect(registry.has('doc')).toBe(false)
  })

  it('persists registrations across instances', async () => {
    const { file, registry } = await createRegistry()
    await registry.register('doc')
    await registry.register('doc')
    const reloaded = new DocumentRegistry(file)
    await reloaded.initialize()
    expect(reloaded.has('doc')).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['doc'])
  })

  it('keeps every id from concurrent registrations', async () => {
    const { file, registry } = await createRegistry()
    await Promise.all(['a', 'b', 'c'].map((id) => registry.register(id)))
    expect(JSON.parse(await readFile(file, 'utf8')).sort()).toEqual(['a', 'b', 'c'])
  })
})
