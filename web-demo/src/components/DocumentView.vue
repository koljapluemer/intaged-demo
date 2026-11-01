<script setup lang="ts">
import type { DocHandle } from '@automerge/automerge-repo'
import { BookOpen, Download, Menu, PencilLine, Share2 } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { titleFromMarkdown } from '../document'
import { downloadBundle } from '../exportBundle'
import type { TheadocDocument } from '../types'
import { t } from '../i18n'
import DocumentReader from './DocumentReader.vue'
import LocaleToggle from './LocaleToggle.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import ShareDialog from './ShareDialog.vue'

const props = defineProps<{ handle: DocHandle<TheadocDocument>; documentId: string }>()
const emit = defineEmits<{ title: [value: string] }>()
const document = ref(props.handle.doc())
const shareDialog = ref<InstanceType<typeof ShareDialog> | null>(null)
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
        :title="reading ? t('document.editDocument') : t('document.readDocument')"
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
        <span class="hidden sm:inline">{{ reading ? t('document.edit') : t('document.read') }}</span>
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :title="t('document.copyLink')"
        @click="shareDialog?.open()"
      >
        <Share2 :size="16" />
        <span class="hidden sm:inline">{{ t('document.share') }}</span>
      </button>
      <button
        class="btn btn-ghost btn-sm"
        :disabled="exporting"
        :title="t('document.exportBundle')"
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
        <span class="hidden sm:inline">{{ t('document.export') }}</span>
      </button>
      <LocaleToggle class="ml-1" />
    </header>
    <ShareDialog
      ref="shareDialog"
      :document-id="documentId"
    />
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
