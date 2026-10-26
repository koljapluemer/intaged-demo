import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, type DecorationSet } from '@codemirror/view'

function decorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
    const line = view.state.doc.line(lineNumber)
    const heading = /^(#{1,3})\s/.exec(line.text)
    if (heading?.[1]) builder.add(line.from, line.from, Decoration.line({ class: `cm-heading-${heading[1].length}` }))
  }
  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'Emphasis') builder.add(node.from, node.to, Decoration.mark({ class: 'italic' }))
      if (node.name === 'StrongEmphasis') builder.add(node.from, node.to, Decoration.mark({ class: 'font-semibold' }))
      if (node.name === 'InlineCode') builder.add(node.from, node.to, Decoration.mark({ class: 'rounded bg-base-200 font-mono text-sm' }))
    },
  })
  return builder.finish()
}

export const markdownPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = decorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = decorations(update.view)
    }
  },
  { decorations: (value) => value.decorations },
)
