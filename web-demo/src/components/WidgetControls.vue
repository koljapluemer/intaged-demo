<script setup lang="ts">
import { RefreshCw, WandSparkles } from '@lucide/vue'
import { computed, ref, watch, type Ref } from 'vue'
import { sha256, WIDGET_MODES, type WidgetMode } from '../widgetBlocks'
import { generation } from '../widgetGeneration'
import type { WidgetArtifact } from '../types'

const props = defineProps<{
  blockId: string | null
  spec: string
  artifact?: WidgetArtifact | null
  mode: WidgetMode
  hoveredKey: Ref<string | null>
  widgetKey: string
}>()
const emit = defineEmits<{
  mode: [mode: WidgetMode]
  generate: []
}>()

const labels: Record<WidgetMode, string> = { spec: 'Spec', rendered: 'Rendered', split: 'Split' }
const currentHash = ref('')
const busy = computed(() => Boolean(generation(props.blockId)?.busy))
const error = computed(() => generation(props.blockId)?.error)
const stale = computed(() => Boolean(props.artifact && currentHash.value && props.artifact.specHash !== currentHash.value))
const hovered = computed(() => props.hoveredKey.value === props.widgetKey)
// Out-of-date, failed or missing renders keep the button visible; otherwise it only shows on hover.
const showGenerate = computed(() => hovered.value ||busy.value || stale.value || Boolean(error.value) || !props.artifact)
const generateTitle = computed(() => {
  if (busy.value) return `${generation(props.blockId)?.stage ?? 'Rendering'}…`
  if (error.value) return `Render failed: ${error.value}`
  if (stale.value) return 'Out of date, re-render'
  return props.artifact ? 'Re-render' : 'Render'
})

watch(() => props.spec, updateHash, { immediate: true })
async function updateHash(spec: string) {
  const hash = await sha256(spec)
  if (spec === props.spec) currentHash.value = hash
}
</script>

<template>
  <div class="flex justify-end">
    <div
      role="tablist"
      class="flex"
    >
      <button
        v-for="option in WIDGET_MODES"
        :key="option"
        role="tab"
        class="cm-widget-tab"
        :class="{ 'cm-widget-tab-active': option === mode }"
        :aria-selected="option === mode"
        @mousedown.prevent
        @click="emit('mode', option)"
      >
        {{ labels[option] }}
      </button>
    </div>
    <!-- Floats over the top-right corner of the box below the tabs. -->
    <button
      class="btn btn-square btn-ghost btn-xs absolute top-full right-1 z-10 mt-1 bg-base-100 shadow-sm transition-opacity"
      :class="[showGenerate ? 'opacity-100' : 'pointer-events-none opacity-0', { 'text-warning': stale, 'text-error': error }]"
      :disabled="busy || !spec"
      :title="generateTitle"
      @mousedown.prevent
      @click="emit('generate')"
    >
      <span
        v-if="busy"
        class="loading loading-spinner loading-xs"
      />
      <RefreshCw
        v-else-if="artifact"
        :size="14"
      />
      <WandSparkles
        v-else
        :size="14"
      />
    </button>
  </div>
</template>
