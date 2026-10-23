import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { createApp, h, type App } from 'vue'
import WidgetCard from '../components/WidgetCard.vue'
import { findWidgetBlocks, type WidgetBlock } from '../widgetBlocks'
import type { WidgetArtifact } from '../types'

export const refreshWidgets = StateEffect.define<void>()

interface WidgetOptions {
  documentId: string
  getRevision: (blockId: string) => string | undefined
  getArtifact: (revision: string) => WidgetArtifact | null | undefined
  onGenerated: (blockId: string, artifact: WidgetArtifact) => void
  onNeedsId: (block: WidgetBlock, blockId: string) => void
}

class WidgetCardWidget extends WidgetType {
  private app?: App

  constructor(
    private readonly block: WidgetBlock,
    private readonly options: WidgetOptions,
    private readonly revision: string | undefined,
    private readonly artifact: WidgetArtifact | null | undefined,
  ) {
    super()
  }

  eq(other: WidgetCardWidget) {
    return (
      this.block.blockId === other.block.blockId &&
      this.block.spec === other.block.spec &&
      this.revision === other.revision &&
      this.artifact === other.artifact
    )
  }

  toDOM() {
    const root = document.createElement('div')
    root.className = 'cm-widget-shell'
    this.app = createApp({
      render: () =>
        h(WidgetCard, {
          documentId: this.options.documentId,
          blockId: this.block.blockId,
          spec: this.block.spec,
          revision: this.revision,
          artifact: this.artifact,
          onGenerated: this.options.onGenerated,
          onNeedsId: (blockId: string) => this.options.onNeedsId(this.block, blockId),
        }),
    })
    this.app.mount(root)
    return root
  }

  destroy() {
    this.app?.unmount()
  }
}

function buildDecorations(state: EditorState, options: WidgetOptions) {
  const builder = new RangeSetBuilder<Decoration>()
  for (const block of findWidgetBlocks(state.doc.toString())) {
    const revision = block.blockId ? options.getRevision(block.blockId) : undefined
    const artifact = revision ? options.getArtifact(revision) : null
    const widget = new WidgetCardWidget(block, options, revision, artifact)
    builder.add(block.to, block.to, Decoration.widget({ widget, block: true, side: 1 }))
  }
  return builder.finish()
}

export function widgetDecorations(options: WidgetOptions) {
  const field = StateField.define({
    create(state) {
      return buildDecorations(state, options)
    },
    update(decorations, transaction) {
      const refresh = transaction.effects.some((effect) => effect.is(refreshWidgets))
      return transaction.docChanged || refresh ? buildDecorations(transaction.state, options) : decorations
    },
    provide: (value) => EditorView.decorations.from(value),
  })
  return field
}
