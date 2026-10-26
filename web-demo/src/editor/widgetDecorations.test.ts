import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { findWidgetBlocks, type WidgetMode } from '../widgetBlocks'
import { setWidgetMode, widgetDecorations, widgetKey } from './widgetDecorations'

vi.mock('../components/WidgetCard.vue', () => ({ default: {} }))
vi.mock('../components/WidgetControls.vue', () => ({ default: {} }))

const markdown = 'Intro\n```intaged\nA map.\n```\nOutro'
const specStart = markdown.indexOf('A map.')
const closingFence = markdown.lastIndexOf('```')

function edit(changes: { from: number; to?: number; insert?: string }, userEvent?: string, mode?: WidgetMode) {
  let state = EditorState.create({
    doc: markdown,
    extensions: widgetDecorations({
      getRevision: () => undefined,
      getArtifact: () => null,
      onGenerate: () => {},
    }),
  })
  if (mode) state = state.update({ effects: setWidgetMode.of({ key: widgetKey(findWidgetBlocks(markdown)[0]!), mode }) }).state
  return state.update({ changes, userEvent }).state.doc.toString()
}

describe('hidden widget fences', () => {
  it('keeps backspace at the start of a spec from merging it into the fence', () => {
    expect(edit({ from: specStart - 1, to: specStart }, 'delete.backward')).toBe(markdown)
  })

  it('keeps forward delete at the end of a spec from merging the closing fence', () => {
    expect(edit({ from: closingFence - 1, to: closingFence }, 'delete.forward')).toBe(markdown)
  })

  it('allows typing in the spec and next to the hidden fences', () => {
    expect(edit({ from: specStart, insert: 'X' }, 'input.type')).toContain('\nXA map.\n')
    expect(edit({ from: 'Intro'.length, insert: '!' }, 'input.type')).toContain('Intro!\n```intaged')
    expect(edit({ from: markdown.indexOf('Outro'), insert: 'X' }, 'input.type')).toContain('```\nXOutro')
  })

  it('allows deleting a whole widget and programmatic edits', () => {
    expect(edit({ from: 0, to: markdown.length }, 'delete.cut')).toBe('')
    expect(edit({ from: specStart - 1, to: specStart })).toContain('```intagedA map.')
  })

  it('protects the spec while it is hidden in rendered mode', () => {
    expect(edit({ from: specStart + 1, insert: 'X' }, 'input.type', 'rendered')).toBe(markdown)
    expect(edit({ from: specStart + 1, insert: 'X' }, 'input.type', 'spec')).toContain('AX map.')
  })
})
