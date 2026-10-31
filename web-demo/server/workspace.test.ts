import { describe, expect, it } from 'vitest'
import { Workspace } from './workspace.js'

const okBuild = { ok: true as const, hash: 'a'.repeat(64), bytes: 10, warnings: [], preinstalled: {} }

describe('Workspace', () => {
  it('replaces exactly one occurrence when editing', () => {
    const workspace = new Workspace()
    workspace.write('main.ts', 'a b a')
    expect(() => workspace.edit('main.ts', 'a', 'c')).toThrow(/more than once/)
    expect(() => workspace.edit('main.ts', 'x', 'c')).toThrow(/not found/)
    workspace.edit('main.ts', 'b', 'c')
    expect(workspace.read('main.ts')).toBe('a c a')
  })

  it('only accepts flat file names with known extensions', () => {
    const workspace = new Workspace()
    expect(() => workspace.write('../escape.ts', '')).toThrow(/Invalid file name/)
    expect(() => workspace.write('nested/file.ts', '')).toThrow(/Invalid file name/)
    expect(() => workspace.write('script.sh', '')).toThrow(/Invalid file name/)
    expect(() => workspace.write('__entry.js', '')).toThrow(/reserved/)
    workspace.write('chart.ts', '')
    expect(workspace.list()).toContain('chart.ts')
  })

  it('is finished once a final change builds cleanly', () => {
    const workspace = new Workspace()
    workspace.transaction(() => workspace.write('main.ts', 'const a = 1'), true)
    expect(workspace.finished).toBe(false)
    workspace.recordBuild({ ok: false, diagnostics: ['main.ts:1:1: broken'] })
    expect(workspace.finished).toBe(false)
    expect(workspace.lastDiagnostics).toEqual(['main.ts:1:1: broken'])
    workspace.recordBuild(okBuild)
    expect(workspace.finished).toBe(true)
    workspace.transaction(() => workspace.write('main.ts', 'changed'), false)
    expect(workspace.currentBundle).toBeNull()
    workspace.recordBuild(okBuild)
    expect(workspace.finished).toBe(false)
    expect(workspace.currentBundle).toBe(okBuild.hash)
  })

  it('rolls back a transaction that fails part way', () => {
    const workspace = new Workspace()
    const before = workspace.source
    expect(() =>
      workspace.transaction(() => {
        workspace.write('main.ts', 'changed')
        workspace.write('../escape.ts', '')
      }, true),
    ).toThrow(/Invalid file name/)
    expect(workspace.source).toEqual(before)
    expect(workspace.changed).toBe(false)
  })

  it('records the preinstalled packages a successful build used', () => {
    const workspace = new Workspace()
    workspace.recordBuild({ ...okBuild, preinstalled: { d3: '7.9.0' } })
    expect(workspace.deps).toEqual({ d3: '7.9.0' })
    expect(workspace.currentBundle).toBe(okBuild.hash)
  })
})
