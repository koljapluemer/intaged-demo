<script setup lang="ts">
import { automergeSyncPlugin } from '@automerge/automerge-codemirror'
import type { DocHandle } from '@automerge/automerge-repo'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { selectRevision } from '../document'
import { markdownPreview } from '../editor/markdownPreview'
import { refreshWidgets, widgetDecorations } from '../editor/widgetDecorations'
import { findWidgetBlocks, withBlockId, type WidgetBlock } from '../widgetBlocks'
import type { TheadocDocument, WidgetArtifact } from '../types'
import { cachedArtifact, loadArtifact, storeArtifact } from '../widgetArtifacts'
import { runGeneration } from '../widgetGeneration'

const props = defineProps<{ handle: DocHandle<TheadocDocument>; documentId: string }>()
const root = ref<HTMLDivElement>()
let view: EditorView | undefined

// CodeMirror's light base theme hardcodes a black caret; follow the page's daisyUI theme instead.
const caretTheme = EditorView.theme({
  '.cm-content': { caretColor: 'var(--color-base-content)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-base-content)' },
})

function selectedRevision(blockId: string) {
  return props.handle.doc().widgets[blockId]?.selectedRevision
}

function artifact(revision: string) {
  const value = cachedArtifact(revision)
  if (value === undefined) void loadArtifact(revision).then(() => view?.dispatch({ effects: refreshWidgets.of() }))
  return value ?? null
}

function generated(blockId: string, value: WidgetArtifact) {
  storeArtifact(value)
  selectRevision(props.handle, blockId, value.id)
  view?.dispatch({ effects: refreshWidgets.of() })
}

function addId(block: WidgetBlock, blockId: string) {
  if (!view) return
  const next = withBlockId(view.state.doc.toString(), block, blockId)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
}

function generate(block: WidgetBlock, errors?: string[]) {
  if (!block.spec) return
  const blockId = block.blockId ?? crypto.randomUUID()
  if (!block.blockId) addId(block, blockId)
  const previousRevision = block.blockId ? selectedRevision(block.blockId) : undefined
  void runGeneration({ documentId: props.documentId, blockId, spec: block.spec, previousRevision, errors }, (value) => generated(blockId, value))
}

function wrap(prefix: string, suffix = prefix) {
  if (!view) return
  const range = view.state.selection.main
  view.dispatch({
    changes: [
      { from: range.from, insert: prefix },
      { from: range.to, insert: suffix },
    ],
    selection: { anchor: range.from + prefix.length, head: range.to + prefix.length },
  })
  view.focus()
}

function linePrefix(prefix: string) {
  if (!view) return
  const line = view.state.doc.lineAt(view.state.selection.main.from)
  view.dispatch({ changes: { from: line.from, insert: prefix }, selection: { anchor: view.state.selection.main.from + prefix.length } })
  view.focus()
}

function insertWidget() {
  if (!view) return
  const id = crypto.randomUUID()
  const position = view.state.selection.main.from
  const placeholder = 'Describe the interactive element.'
  const value = `\n\`\`\`intaged id=${id}\n${placeholder}\n\`\`\`\n`
  const anchor = position + value.indexOf(placeholder)
  view.dispatch({ changes: { from: position, insert: value }, selection: { anchor, head: anchor + placeholder.length } })
  view.focus()
}

onMounted(() => {
  view = new EditorView({
    parent: root.value,
    state: EditorState.create({
      doc: props.handle.doc().markdown,
      extensions: [
        history(),
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        caretTheme,
        automergeSyncPlugin({ handle: props.handle, path: ['markdown'] }),
        markdownPreview,
        widgetDecorations({
          getRevision: selectedRevision,
          getArtifact: artifact,
          onGenerate: generate,
        }),
      ],
    }),
  })
  for (const block of findWidgetBlocks(props.handle.doc().markdown)) {
    if (block.blockId) {
      const revision = selectedRevision(block.blockId)
      if (revision) artifact(revision)
    }
  }
})

onBeforeUnmount(() => view?.destroy())

defineExpose({ insertWidget })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex min-h-11 items-center gap-1 border-b border-base-300 px-3">
      <button
        class="btn btn-ghost btn-sm font-bold"
        title="Heading"
        @click="linePrefix('## ')"
      >
        H
      </button>
      <button
        class="btn btn-ghost btn-sm font-bold"
        title="Bold"
        @click="wrap('**')"
      >
        B
      </button>
      <button
        class="btn btn-ghost btn-sm italic"
        title="Italic"
        @click="wrap('_')"
      >
        I
      </button>
      <button
        class="btn btn-ghost btn-sm"
        title="Bullet list"
        @click="linePrefix('- ')"
      >
        • List
      </button>
      <button
        class="btn btn-ghost btn-sm"
        title="Insert interactive element"
        @click="insertWidget"
      >
        Interactive Element
      </button>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div
        ref="root"
        class="mx-auto min-h-full max-w-3xl px-6"
      />
    </div>
  </div>
</template>
