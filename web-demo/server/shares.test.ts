import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findWidgetBlocks } from '../src/widgetBlocks.js'
import { redactSpecs, ShareRegistry } from './shares.js'

async function createRegistry() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'theadoc-shares-'))
  const file = path.join(directory, 'shares.json')
  const registry = new ShareRegistry(file)
  await registry.initialize()
  return { file, registry }
}

describe('ShareRegistry', () => {
  it('starts empty without a file', async () => {
    const { registry } = await createRegistry()
    expect(registry.get('missing')).toBeUndefined()
  })

  it('reuses the token for the same document and access level', async () => {
    const { registry } = await createRegistry()
    const token = await registry.create('doc', 'reader')
    expect(await registry.create('doc', 'reader')).toBe(token)
    expect(await registry.create('doc', 'spec')).not.toBe(token)
    expect(registry.get(token)).toEqual({ documentId: 'doc', access: 'reader' })
  })

  it('persists shares across instances', async () => {
    const { file, registry } = await createRegistry()
    const token = await registry.create('doc', 'spec')
    const reloaded = new ShareRegistry(file)
    await reloaded.initialize()
    expect(reloaded.get(token)).toEqual({ documentId: 'doc', access: 'spec' })
  })

  it('keeps every share from concurrent creations', async () => {
    const { file, registry } = await createRegistry()
    const tokens = await Promise.all(['a', 'b', 'c'].map((id) => registry.create(id, 'reader')))
    const reloaded = new ShareRegistry(file)
    await reloaded.initialize()
    expect(tokens.map((token) => reloaded.get(token)?.documentId)).toEqual(['a', 'b', 'c'])
  })
})

describe('redactSpecs', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'

  it('removes widget specs but keeps the blocks', () => {
    const markdown = `# Title\n\nText\n\n\`\`\`intaged id=${id}\nA secret spec\nover two lines\n\`\`\`\n\nMore\n\n\`\`\`js\nkept()\n\`\`\`\n`
    const redacted = redactSpecs(markdown)
    expect(redacted).not.toContain('secret')
    expect(redacted).toContain('kept()')
    expect(redacted).toContain('More')
    expect(findWidgetBlocks(redacted)).toMatchObject([{ blockId: id, spec: '' }])
  })
})
