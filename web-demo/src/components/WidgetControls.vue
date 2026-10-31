<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { sha256, WIDGET_MODES, type WidgetMode } from '../widgetBlocks'
import { generation } from '../widgetGeneration'
import type { WidgetArtifact } from '../types'

const props = defineProps<{
  blockId: string | null
  spec: string
  artifact?: WidgetArtifact | null
  mode: WidgetMode
}>()
const emit = defineEmits<{
  mode: [mode: WidgetMode]
  generate: [fresh: boolean]
}>()

const labels: Record<WidgetMode, string> = { spec: 'Spec', rendered: 'Rendered', split: 'Split' }
const currentHash = ref('')
// Which button started the running generation, so only that one shows the spinner.
const started = ref<boolean | null>(null)
const busy = computed(() => Boolean(generation(props.blockId)?.busy))
const error = computed(() => generation(props.blockId)?.error)
const stale = computed(() => Boolean(props.artifact && currentHash.value && props.artifact.specHash !== currentHash.value))
const status = computed(() => {
  if (busy.value) return `${generation(props.blockId)?.stage ?? 'Rendering'}…`
  if (error.value) return `Render failed: ${error.value}`
  if (stale.value) return 'Out of date with the spec'
  return undefined
})

watch(() => props.spec, updateHash, { immediate: true })
watch(busy, (value) => {
  if (!value) started.value = null
})

async function updateHash(spec: string) {
  const hash = await sha256(spec)
  if (spec === props.spec) currentHash.value = hash
}

function generate(fresh: boolean) {
  started.value = fresh
  emit('generate', fresh)
}
</script>

<template>
  <div class="flex items-end justify-between gap-2">
    <div class="flex gap-1 pb-1">
      <button
        class="btn btn-xs"
        :class="stale || !artifact ? 'btn-primary' : 'btn-ghost'"
        :disabled="busy || !spec"
        :title="status"
        @mousedown.prevent
        @click="generate(false)"
      >
        <span
          v-if="busy && started === false"
          class="loading loading-spinner loading-xs"
        />
        {{ artifact ? 'Generate new version' : 'Generate' }}
      </button>
      <button
        v-if="artifact"
        class="btn btn-ghost btn-xs"
        :disabled="busy || !spec"
        :title="status ?? 'Discard the current code and generate from the spec alone'"
        @mousedown.prevent
        @click="generate(true)"
      >
        <span
          v-if="busy && started === true"
          class="loading loading-spinner loading-xs"
        />
        Regenerate from scratch
      </button>
    </div>
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
  </div>
</template>
