<script setup lang="ts">
import { automergeSyncPlugin } from '@automerge/automerge-codemirror'
import type { DocHandle } from '@automerge/automerge-repo'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getWidget } from '../api'
import { selectRevision } from '../document'
import { markdownPreview } from '../editor/markdownPreview'
import { refreshWidgets, widgetDecorations } from '../editor/widgetDecorations'
import { findWidgetBlocks, withBlockId, type WidgetBlock } from '../widgetBlocks'
import type { TheadocDocument, WidgetArtifact } from '../types'

const props = defineProps<{ handle: DocHandle<TheadocDocument>; documentId: string }>()
const root = ref<HTMLDivElement>()
const artifacts = new Map<string, WidgetArtifact | null>()
let view: EditorView | undefined

function selectedRevision(blockId: string) {
  return props.handle.doc().widgets[blockId]?.selectedRevision
}

function artifact(revision: string) {
  if (!artifacts.has(revision)) {
    artifacts.set(revision, null)
    void getWidget(revision).then((value) => {
      artifacts.set(revision, value)
      view?.dispatch({ effects: refreshWidgets.of() })
    })
  }
  return artifacts.get(revision)
}

function generated(blockId: string, value: WidgetArtifact) {
  artifacts.set(value.id, value)
  selectRevision(props.handle, blockId, value.id)
  view?.dispatch({ effects: refreshWidgets.of() })
}

function addId(block: WidgetBlock, blockId: string) {
  if (!view) return
  const next = withBlockId(view.state.doc.toString(), block, blockId)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
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
  const value = `\n\`\`\`intaged id=${id}\nDescribe the widget.\n\`\`\`\n`
  view.dispatch({ changes: { from: position, insert: value }, selection: { anchor: position + value.indexOf('Describe') } })
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
        automergeSyncPlugin({ handle: props.handle, path: ['markdown'] }),
        markdownPreview,
        widgetDecorations({
          documentId: props.documentId,
          getRevision: selectedRevision,
          getArtifact: artifact,
          onGenerated: generated,
          onNeedsId: addId,
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
      <div class="flex-1" />
      <button
        class="btn btn-primary btn-sm"
        @click="insertWidget"
      >
        Widget
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
