<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { generation } from '../widgetGeneration'
import type { WidgetArtifact } from '../types'
import WidgetFrame from './WidgetFrame.vue'

const props = defineProps<{
  blockId: string | null
  artifact?: WidgetArtifact | null
}>()
const emit = defineEmits<{ regenerate: [errors: string[]] }>()

const runtimeErrors = ref<string[]>([])
const error = computed(() => generation(props.blockId)?.error)
const stage = computed(() => {
  const current = generation(props.blockId)
  return current?.busy ? `${current.stage ?? 'Rendering'}…` : null
})

watch(
  () => props.artifact,
  () => (runtimeErrors.value = []),
)

function reportRuntimeError(message: string) {
  if (!runtimeErrors.value.includes(message) && runtimeErrors.value.length < 10) runtimeErrors.value.push(message)
  if (runtimeErrors.value.length === 1) window.setTimeout(() => emit('regenerate', [...runtimeErrors.value]), 1500)
}
</script>

<template>
  <div>
    <WidgetFrame
      v-if="artifact"
      :artifact="artifact"
      @error="reportRuntimeError"
    />
    <div
      v-else
      class="flex h-36 items-center justify-center gap-2 rounded-box border-2 border-dashed border-base-300 text-sm opacity-50"
    >
      <template v-if="stage">
        <span class="loading loading-spinner loading-xs" />
        {{ stage }}
      </template>
      <template v-else>
        Not rendered yet
      </template>
    </div>
    <div
      v-if="artifact && stage"
      class="mt-1 flex items-center gap-2 text-xs opacity-60"
    >
      <span class="loading loading-spinner loading-xs" />
      {{ stage }}
    </div>
    <div
      v-if="error"
      role="alert"
      class="alert alert-error alert-soft mt-2 py-2 text-sm"
    >
      <TriangleAlert :size="16" />
      <span>{{ error }}</span>
      <button
        class="btn btn-ghost btn-xs"
        @click="emit('regenerate', [])"
      >
        Try again
      </button>
    </div>
  </div>
</template>
