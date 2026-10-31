<script setup lang="ts">
import { automergeSyncPlugin } from '@automerge/automerge-codemirror'
import type { DocHandle } from '@automerge/automerge-repo'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, Prec } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import {
  collapseOnSelectionFacet,
  editorTheme,
  livePreviewPlugin,
  markdownStylePlugin,
  mouseSelectingField,
  setMouseSelecting,
} from 'codemirror-live-markdown'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { selectRevision } from '../document'
import { refreshWidgets, widgetDecorations } from '../editor/widgetDecorations'
import { findWidgetBlocks, withBlockId, type WidgetBlock } from '../widgetBlocks'
import type { TheadocDocument, WidgetArtifact } from '../types'
import { cachedArtifact, loadArtifact, storeArtifact } from '../widgetArtifacts'
import { runGeneration } from '../widgetGeneration'
import { t } from '../i18n'

const props = defineProps<{ handle: DocHandle<TheadocDocument>; documentId: string }>()
const root = ref<HTMLDivElement>()
let view: EditorView | undefined

// The live-markdown theme and CodeMirror's base theme assume their own colors; follow the page's daisyUI theme instead.
const muted = 'color-mix(in oklab, var(--color-base-content) 50%, transparent)'
const daisyTheme = Prec.high(
  EditorView.theme({
    '.cm-content': { caretColor: 'var(--color-base-content)', fontFamily: 'ui-sans-serif, system-ui, sans-serif', lineHeight: '1.7' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-base-content)' },
    '.cm-line': { padding: '0 2px 0 6px', lineHeight: 'inherit' },
    '.cm-formatting-inline, .cm-formatting-block': { color: muted },
    '.cm-header-1, .cm-header-2, .cm-header-3, .cm-header-4, .cm-header-5, .cm-header-6, .cm-strong, .cm-emphasis': { color: 'inherit' },
    '.cm-strikethrough': { color: muted },
    '.cm-code': { backgroundColor: 'var(--color-base-200)' },
    '.cm-link': { color: 'var(--color-primary)' },
  }),
)

// The live preview keeps markup hidden while a mouse selection is being dragged.
function startMouseSelection() {
  view?.dispatch({ effects: setMouseSelecting.of(true) })
}

function endMouseSelection() {
  if (!view?.state.field(mouseSelectingField, false)) return
  requestAnimationFrame(() => view?.dispatch({ effects: setMouseSelecting.of(false) }))
}

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
  view.dispatch({ changes: withBlockId(block, blockId) })
}

function generate(block: WidgetBlock, { errors, fresh = false }: { errors?: string[]; fresh?: boolean } = {}) {
  if (!block.spec) return
  const blockId = block.blockId ?? crypto.randomUUID()
  if (!block.blockId) addId(block, blockId)
  // Without a previous revision the agent starts from the placeholder workspace; older revisions stay in the history.
  const previousRevision = block.blockId && !fresh ? selectedRevision(block.blockId) : undefined
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
  const placeholder = t('editor.widgetPlaceholder')
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
        drawSelection(),
        markdown({ base: markdownLanguage }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        collapseOnSelectionFacet.of(true),
        mouseSelectingField,
        livePreviewPlugin,
        markdownStylePlugin,
        editorTheme,
        daisyTheme,
        automergeSyncPlugin({ handle: props.handle, path: ['markdown'] }),
        widgetDecorations({
          getRevision: selectedRevision,
          getArtifact: artifact,
          onGenerate: generate,
        }),
      ],
    }),
  })
  view.contentDOM.addEventListener('mousedown', startMouseSelection)
  document.addEventListener('mouseup', endMouseSelection)
  for (const block of findWidgetBlocks(props.handle.doc().markdown)) {
    if (block.blockId) {
      const revision = selectedRevision(block.blockId)
      if (revision) artifact(revision)
    }
  }
})

onBeforeUnmount(() => {
  view?.contentDOM.removeEventListener('mousedown', startMouseSelection)
  document.removeEventListener('mouseup', endMouseSelection)
  view?.destroy()
})

defineExpose({ insertWidget })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex min-h-11 items-center gap-1 border-b border-base-300 px-3">
      <button
        class="btn btn-ghost btn-sm font-bold"
        :title="t('editor.heading')"
        @click="linePrefix('## ')"
      >
        H
      </button>
      <button
        class="btn btn-ghost btn-sm font-bold"
        :title="t('editor.bold')"
        @click="wrap('**')"
      >
        B
      </button>
      <button
        class="btn btn-ghost btn-sm italic"
        :title="t('editor.italic')"
        @click="wrap('_')"
      >
        I
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :title="t('editor.bulletList')"
        @click="linePrefix('- ')"
      >
        • {{ t('editor.list') }}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :title="t('editor.insertWidget')"
        @click="insertWidget"
      >
        {{ t('editor.widget') }}
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
