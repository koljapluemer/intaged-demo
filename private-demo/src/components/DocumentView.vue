<script setup lang="ts">
import type { DocHandle } from '@automerge/automerge-repo'
import { BookOpen, Check, Copy, Download, Menu, PencilLine } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { titleFromMarkdown } from '../document'
import { downloadBundle } from '../exportBundle'
import type { TheadocDocument } from '../types'
import DocumentReader from './DocumentReader.vue'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps<{ handle: DocHandle<TheadocDocument>; documentId: string }>()
const emit = defineEmits<{ title: [value: string] }>()
const document = ref(props.handle.doc())
const copied = ref(false)
const exporting = ref(false)
const exportError = ref<string | null>(null)
const reading = ref(false)
const title = computed(() => titleFromMarkdown(document.value.markdown))

const onChange = () => {
  document.value = props.handle.doc()
  emit('title', title.value)
}
props.handle.on('change', onChange)
onBeforeUnmount(() => props.handle.off('change', onChange))

async function copyLink() {
  await navigator.clipboard.writeText(location.href)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

async function exportDocument() {
  exporting.value = true
  exportError.value = null
  try {
    await downloadBundle(props.documentId, props.handle.doc())
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : String(error)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="navbar min-h-12 border-b border-base-300 px-3">
      <label
        for="drawer"
        class="btn btn-square btn-ghost btn-sm lg:hidden"
      ><Menu :size="17" /></label>
      <h1 class="flex-1 truncate px-2 font-semibold">
        {{ title }}
      </h1>
      <button
        class="btn btn-ghost btn-sm"
        :title="reading ? 'Edit document' : 'Read document'"
        @click="reading = !reading"
      >
        <PencilLine
          v-if="reading"
          :size="16"
        />
        <BookOpen
          v-else
          :size="16"
        />
        <span class="hidden sm:inline">{{ reading ? 'Edit' : 'Read' }}</span>
      </button>
      <button
        class="btn btn-ghost btn-sm"
        title="Copy edit link"
        @click="copyLink"
      >
        <Check
          v-if="copied"
          :size="16"
        />
        <Copy
          v-else
          :size="16"
        />
        <span class="hidden sm:inline">{{ copied ? 'Copied' : 'Share' }}</span>
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :disabled="exporting"
        title="Export portable bundle"
        @click="exportDocument"
      >
        <span
          v-if="exporting"
          class="loading loading-spinner loading-xs"
        />
        <Download
          v-else
          :size="16"
        />
        <span class="hidden sm:inline">Export</span>
      </button>
    </header>
    <div
      v-if="exportError"
      role="alert"
      class="alert alert-error rounded-none py-2 text-sm"
    >
      {{ exportError }}
    </div>
    <DocumentReader
      v-if="reading"
      :document="document"
      class="min-h-0 flex-1"
    />
    <MarkdownEditor
      v-else
      :handle="handle"
      :document-id="documentId"
      class="min-h-0 flex-1"
    />
  </div>
</template>
