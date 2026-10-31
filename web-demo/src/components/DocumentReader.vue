<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import { computed, watchEffect } from 'vue'
import type { TheadocDocument } from '../types'
import { cachedArtifact, loadArtifact } from '../widgetArtifacts'
import { splitWidgetBlocks } from '../widgetBlocks'
import WidgetFrame from './WidgetFrame.vue'
import { t } from '../i18n'

const props = defineProps<{ document: TheadocDocument }>()
// Raw HTML stays disabled: documents are editable by anyone holding the link.
const markdown = new MarkdownIt({ html: false, linkify: true })

const segments = computed(() =>
  splitWidgetBlocks(props.document.markdown).map((segment) => {
    if (segment.kind === 'markdown') return { ...segment, html: markdown.render(segment.text) }
    const revision = segment.block.blockId ? props.document.widgets[segment.block.blockId]?.selectedRevision : undefined
    return { ...segment, revision, artifact: revision ? cachedArtifact(revision) : null }
  }),
)

watchEffect(() => {
  for (const segment of segments.value) {
    if (segment.kind === 'widget' && segment.revision && segment.artifact === undefined) void loadArtifact(segment.revision)
  }
})
</script>

<template>
  <div class="overflow-y-auto">
    <article class="prose mx-auto max-w-3xl px-6 pt-8 pb-[45vh]">
      <template
        v-for="(segment, index) in segments"
        :key="index"
      >
        <!-- eslint-disable vue/no-v-html -- markdown-it output with raw HTML disabled -->
        <div
          v-if="segment.kind === 'markdown'"
          v-html="segment.html"
        />
        <!-- eslint-enable vue/no-v-html -->
        <div
          v-else
          class="not-prose my-4"
        >
          <WidgetFrame
            v-if="segment.artifact"
            :artifact="segment.artifact"
          />
          <div
            v-else
            class="flex h-24 items-center justify-center rounded-box border-2 border-dashed border-base-300 text-sm opacity-50"
          >
            {{ segment.artifact === undefined ? t('widget.loading') : segment.revision ? t('widget.unavailable') : t('widget.notGenerated') }}
          </div>
        </div>
      </template>
    </article>
  </div>
</template>
