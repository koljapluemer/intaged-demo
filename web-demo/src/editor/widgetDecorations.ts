import { EditorState, RangeSet, StateEffect, StateField, type Extension, type Range, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import { createApp, h, shallowReactive, type App, type Component } from 'vue'
import WidgetCard from '../components/WidgetCard.vue'
import WidgetControls from '../components/WidgetControls.vue'
import { findWidgetBlocks, type WidgetBlock, type WidgetMode } from '../widgetBlocks'
import type { WidgetArtifact } from '../types'

export const refreshWidgets = StateEffect.define<void>()
export const setWidgetMode = StateEffect.define<{ key: string; mode: WidgetMode }>()
const setHoveredWidget = StateEffect.define<string | null>()

interface WidgetOptions {
  getRevision: (blockId: string) => string | undefined
  getArtifact: (revision: string) => WidgetArtifact | null | undefined
  onGenerate: (block: WidgetBlock, errors?: string[]) => void
}

export function widgetKey(block: WidgetBlock) {
  return block.blockId ?? `at:${block.from}`
}

function sameBlock(a: WidgetBlock, b: WidgetBlock) {
  return a.from === b.from && a.to === b.to && a.blockId === b.blockId && a.spec === b.spec
}

// Vue apps survive spec edits, so the iframe is not reloaded on every keystroke.
const mountedApps = new WeakMap<HTMLElement, { app: App; props: object }>()

abstract class VueWidget extends WidgetType {
  protected abstract readonly component: Component
  protected abstract className(): string
  protected abstract props(view: EditorView): object

  toDOM(view: EditorView) {
    const root = document.createElement('div')
    root.className = this.className()
    const props = shallowReactive(this.props(view))
    const component = this.component
    const app = createApp({ render: () => h(component, props) })
    app.mount(root)
    mountedApps.set(root, { app, props })
    return root
  }

  updateDOM(dom: HTMLElement, view: EditorView) {
    const mounted = mountedApps.get(dom)
    if (!mounted) return false
    dom.className = this.className()
    Object.assign(mounted.props, this.props(view))
    return true
  }

  destroy(dom: HTMLElement) {
    mountedApps.get(dom)?.app.unmount()
    mountedApps.delete(dom)
  }
}

class ControlsWidget extends VueWidget {
  protected readonly component = WidgetControls

  constructor(
    private readonly block: WidgetBlock,
    private readonly mode: WidgetMode,
    private readonly hovered: boolean,
    private readonly artifact: WidgetArtifact | null | undefined,
    private readonly options: WidgetOptions,
  ) {
    super()
  }

  eq(other: ControlsWidget) {
    return sameBlock(this.block, other.block) && this.mode === other.mode && this.hovered === other.hovered && this.artifact === other.artifact
  }

  protected className() {
    return `cm-widget-head cm-widget-head-${this.mode}`
  }

  protected props(view: EditorView) {
    return {
      blockId: this.block.blockId,
      spec: this.block.spec,
      artifact: this.artifact,
      mode: this.mode,
      hovered: this.hovered,
      onMode: (mode: WidgetMode) => {
        // Keep the cursor out of spec text that is about to be hidden.
        const { head } = view.state.selection.main
        const hidesCursor = mode === 'rendered' && head > this.block.from && head < this.block.to
        view.dispatch({
          effects: setWidgetMode.of({ key: widgetKey(this.block), mode }),
          selection: hidesCursor ? { anchor: Math.min(this.block.to + 1, view.state.doc.length) } : undefined,
        })
      },
      onGenerate: () => this.options.onGenerate(this.block),
    }
  }
}

class CardWidget extends VueWidget {
  protected readonly component = WidgetCard

  constructor(
    private readonly block: WidgetBlock,
    private readonly artifact: WidgetArtifact | null | undefined,
    private readonly options: WidgetOptions,
  ) {
    super()
  }

  eq(other: CardWidget) {
    return sameBlock(this.block, other.block) && this.artifact === other.artifact
  }

  protected className() {
    return 'cm-widget-shell'
  }

  protected props() {
    return {
      blockId: this.block.blockId,
      artifact: this.artifact,
      onRegenerate: (errors: string[]) => this.options.onGenerate(this.block, errors),
    }
  }
}

// Local view state: not part of the shared document.
interface WidgetUi {
  modes: ReadonlyMap<string, WidgetMode>
  hovered: string | null
}

const widgetUi = StateField.define<WidgetUi>({
  create: () => ({ modes: new Map(), hovered: null }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setWidgetMode)) value = { ...value, modes: new Map(value.modes).set(effect.value.key, effect.value.mode) }
      if (effect.is(setHoveredWidget)) value = { ...value, hovered: effect.value }
    }
    return value
  },
})

interface WidgetState {
  decorations: DecorationSet
  // Fence lines plus their adjacent line breaks: the cursor skips them and typing cannot break them.
  fences: RangeSet<Decoration>
  blocks: WidgetBlock[]
}

const hiddenLine = Decoration.replace({ block: true })
const fenceRange = Decoration.mark({})

function buildState(state: EditorState, options: WidgetOptions): WidgetState {
  const { modes, hovered } = state.field(widgetUi)
  const decorations: Range<Decoration>[] = []
  const fences: Range<Decoration>[] = []
  const blocks = findWidgetBlocks(state.doc.toString())
  for (const block of blocks) {
    const key = widgetKey(block)
    const mode = modes.get(key) ?? 'split'
    const opening = state.doc.lineAt(block.from)
    const closing = state.doc.lineAt(block.to)
    const revision = block.blockId ? options.getRevision(block.blockId) : undefined
    const artifact = revision ? options.getArtifact(revision) : null
    // The rendered mode folds the spec lines into the controls, which also protects them like a fence.
    const headTo = mode === 'rendered' && closing.number > opening.number + 1 ? closing.from - 1 : opening.to
    const controls = new ControlsWidget(block, mode, hovered === key, artifact, options)
    decorations.push(Decoration.replace({ widget: controls, block: true }).range(opening.from, headTo))
    if (mode !== 'rendered') {
      for (let number = opening.number + 1; number < closing.number; number++) {
        const classes = ['cm-widget-spec']
        if (number === opening.number + 1) classes.push('cm-widget-spec-first')
        if (number === closing.number - 1) classes.push('cm-widget-spec-last')
        decorations.push(Decoration.line({ class: classes.join(' ') }).range(state.doc.line(number).from))
      }
    }
    const card = mode === 'spec' ? hiddenLine : Decoration.replace({ widget: new CardWidget(block, artifact, options), block: true })
    decorations.push(card.range(closing.from, closing.to))
    fences.push(fenceRange.range(Math.max(opening.from - 1, 0), headTo + 1))
    fences.push(fenceRange.range(closing.from - 1, Math.min(closing.to + 1, state.doc.length)))
  }
  return { decorations: Decoration.set(decorations, true), fences: Decoration.set(fences, true), blocks }
}
function protectedFences(transaction: Transaction, field: StateField<WidgetState>): readonly number[] | true {
  if (!['input', 'delete', 'move'].some((event) => transaction.isUserEvent(event))) return true
  const { fences, blocks } = transaction.startState.field(field)
  // Deleting a whole widget block (for example as part of a larger selection) stays allowed.
  const removed = blocks.filter((block) => {
    let covered = false
    transaction.changes.iterChangedRanges((from, to) => {
      if (from <= block.from && to >= block.to) covered = true
    })
    return covered
  })
  const ranges: number[] = []
  fences.between(0, transaction.startState.doc.length, (from, to) => {
    if (removed.some((block) => from >= block.from - 1 && to <= block.to + 1)) return
    const last = ranges.length - 1
    if (last > 0 && from <= ranges[last]!) ranges[last] = Math.max(ranges[last]!, to)
    else ranges.push(from, to)
  })
  return ranges.length ? ranges : true
}

export function widgetDecorations(options: WidgetOptions): Extension {
  const field: StateField<WidgetState> = StateField.define({
    create(state) {
      return buildState(state, options)
    },
    update(value, transaction) {
      const refresh = transaction.effects.some((effect) => effect.is(refreshWidgets))
      const uiChanged = transaction.startState.field(widgetUi) !== transaction.state.field(widgetUi)
      return transaction.docChanged || refresh || uiChanged ? buildState(transaction.state, options) : value
    },
    provide: (value) => [
      EditorView.decorations.from(value, (state) => state.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(value).fences),
      EditorState.changeFilter.of((transaction) => protectedFences(transaction, value)),
    ],
  })
  // Listens on the editor element directly: CodeMirror's own handlers skip events inside widgets.
  const hover = ViewPlugin.define((view) => {
    const setHovered = (key: string | null) => {
      if (view.state.field(widgetUi).hovered !== key) view.dispatch({ effects: setHoveredWidget.of(key) })
    }
    const onMove = (event: MouseEvent) => {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      const block = pos === null ? undefined : view.state.field(field).blocks.find((candidate) => candidate.from <= pos && pos <= candidate.to)
      setHovered(block ? widgetKey(block) : null)
    }
    const onLeave = () => setHovered(null)
    view.dom.addEventListener('mousemove', onMove)
    view.dom.addEventListener('mouseleave', onLeave)
    return {
      destroy() {
        view.dom.removeEventListener('mousemove', onMove)
        view.dom.removeEventListener('mouseleave', onLeave)
      },
    }
  })
  return [widgetUi, field, hover]
}
