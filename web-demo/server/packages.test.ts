import { afterEach, describe, expect, it, vi } from 'vitest'
import { PackageRegistry } from './packages.js'

function mockRegistry(packument: object, weekly = 1_000_000) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('api.npmjs.org/downloads') ? { downloads: weekly } : packument
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
}

const packument = (versions: Record<string, object>, latest: string) => ({
  name: 'pkg',
  'dist-tags': { latest },
  versions: Object.fromEntries(Object.entries(versions).map(([version, extra]) => [version, { version, ...extra }])),
})

afterEach(() => vi.unstubAllGlobals())

describe('PackageRegistry.resolve', () => {
  it('resolves dist-tags and semver ranges to exact versions', async () => {
    mockRegistry(packument({ '1.2.0': {}, '1.9.3': {}, '2.0.0': {} }, '2.0.0'))
    const registry = new PackageRegistry()
    await expect(registry.resolve('pkg')).resolves.toMatchObject({ version: '2.0.0' })
    await expect(registry.resolve('pkg', '^1.2.0')).resolves.toMatchObject({ version: '1.9.3' })
    await expect(registry.resolve('pkg', '^3')).rejects.toThrow(/No version/)
  })

  it('rejects invalid names, deprecated, native and unpopular packages', async () => {
    const registry = new PackageRegistry()
    await expect(registry.resolve('../etc')).rejects.toThrow(/not a valid/)

    mockRegistry(packument({ '1.0.0': { deprecated: 'use other' } }, '1.0.0'))
    await expect(new PackageRegistry().resolve('pkg')).rejects.toThrow(/deprecated/)

    mockRegistry(packument({ '1.0.0': { os: ['darwin'] } }, '1.0.0'))
    await expect(new PackageRegistry().resolve('pkg')).rejects.toThrow(/native/)

    mockRegistry(packument({ '1.0.0': {} }, '1.0.0'), 3)
    await expect(new PackageRegistry().resolve('pkg')).rejects.toThrow(/weekly downloads/)
  })

  it('reports missing packages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    await expect(new PackageRegistry().resolve('does-not-exist')).rejects.toThrow(/does not exist/)
  })
})
