<script setup lang="ts">
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { Check, Menu, Sparkles } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import { getDoc, saveDoc } from '../api'
import { CodeBlockWithWidgets, INTAGED_LANGUAGE } from '../editor/CodeBlockWithWidgets'

const props = defineProps<{ name: string }>()

const SAVE_DELAY_MS = 800
// Keep the caret this far from the viewport's bottom edge while typing.
const CARET_BOTTOM_MARGIN_PX = 200
const caretScroll = { top: 5, left: 5, right: 5, bottom: CARET_BOTTOM_MARGIN_PX }

const saveState = ref<'saved' | 'saving' | 'dirty' | 'error'>('saved')
const loadError = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | undefined

const editor = useEditor({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    CodeBlockWithWidgets.configure({ docName: props.name }),
    Markdown,
  ],
  editorProps: {
    // pb-[50vh]: lets the document scroll past its last line.
    attributes: { class: 'prose prose-sm sm:prose-base max-w-none pt-6 pb-[50vh] focus:outline-none' },
    scrollMargin: caretScroll,
    scrollThreshold: caretScroll,
  },
  onUpdate: () => {
    saveState.value = 'dirty'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_DELAY_MS)
  },
})

async function save() {
  if (!editor.value) return
  clearTimeout(saveTimer)
  saveState.value = 'saving'
  try {
    await saveDoc(props.name, editor.value.getMarkdown())
    saveState.value = 'saved'
  } catch {
    saveState.value = 'error'
  }
}

getDoc(props.name)
  .then((doc) => {
    // emitUpdate: false — loading isn't an edit, so don't trigger a save.
    editor.value?.commands.setContent(doc.content, { contentType: 'markdown', emitUpdate: false })
  })
  .catch((e) => (loadError.value = e instanceof Error ? e.message : String(e)))

function insertWidget() {
  editor.value
    ?.chain()
    .focus()
    .insertContent({ type: 'codeBlock', attrs: { language: INTAGED_LANGUAGE } })
    .run()
}

onBeforeUnmount(() => {
  if (saveState.value === 'dirty') save()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="navbar min-h-12 border-b border-base-300 px-4">
      <label
        for="drawer"
        class="btn btn-square btn-ghost btn-sm lg:hidden"
      ><Menu :size="16" /></label>
      <h1 class="flex-1 truncate font-semibold">
        {{ name }}
      </h1>
      <span class="mr-3 flex items-center gap-1 text-xs opacity-60">
        <template v-if="saveState === 'saved'"><Check :size="12" /> Saved</template>
        <template v-else-if="saveState === 'error'"><span class="text-error">Save failed</span></template>
        <template v-else>Saving…</template>
      </span>
      <button
        class="btn btn-primary btn-sm"
        title="Insert widget block"
        @click="insertWidget"
      >
        <Sparkles :size="14" /> Widget
      </button>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl px-6">
        <div
          v-if="loadError"
          class="alert alert-error mt-6"
        >
          {{ loadError }}
        </div>
        <EditorContent :editor="editor" />
      </div>
    </div>
  </div>
</template>
