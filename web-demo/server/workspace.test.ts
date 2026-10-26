import { describe, expect, it } from 'vitest'
import { Workspace } from './workspace.js'

const okBuild = { ok: true as const, hash: 'a'.repeat(64), bytes: 10, warnings: [] }

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

  it('only finishes after a successful build of the current revision', () => {
    const workspace = new Workspace()
    expect(() => workspace.finish()).toThrow(/Run build/)
    workspace.recordBuild({ ok: false, diagnostics: ['main.ts:1:1: broken'] })
    expect(() => workspace.finish()).toThrow(/Run build/)
    expect(workspace.lastDiagnostics).toEqual(['main.ts:1:1: broken'])
    workspace.recordBuild(okBuild)
    workspace.write('main.ts', 'changed')
    expect(workspace.currentBundle).toBeNull()
    workspace.recordBuild(okBuild)
    workspace.finish()
    expect(workspace.finished).toBe(true)
    expect(workspace.currentBundle).toBe(okBuild.hash)
  })
})
