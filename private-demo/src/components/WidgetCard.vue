<script setup lang="ts">
import { RefreshCw, TriangleAlert, WandSparkles } from '@lucide/vue'
import { computed, ref } from 'vue'
import { generateWidget } from '../api'
import { sha256 } from '../widgetBlocks'
import type { WidgetArtifact } from '../types'
import WidgetFrame from './WidgetFrame.vue'

const props = defineProps<{
  documentId: string
  blockId: string | null
  spec: string
  revision?: string
  artifact?: WidgetArtifact | null
}>()
const emit = defineEmits<{
  generated: [blockId: string, artifact: WidgetArtifact]
  needsId: [blockId: string]
}>()

const busy = ref(false)
const error = ref<string | null>(null)
const runtimeErrors = ref<string[]>([])
const currentHash = ref('')
const stale = computed(() => Boolean(props.artifact && currentHash.value && props.artifact.specHash !== currentHash.value))

void updateHash()
async function updateHash() {
  currentHash.value = await sha256(props.spec)
}

async function generate(errors?: string[]) {
  if (!props.spec.trim() || busy.value) return
  const blockId = props.blockId ?? crypto.randomUUID()
  if (!props.blockId) emit('needsId', blockId)
  busy.value = true
  error.value = null
  try {
    const artifact = await generateWidget({
      documentId: props.documentId,
      blockId,
      spec: props.spec,
      previousRevision: props.revision,
      errors,
    })
    runtimeErrors.value = []
    emit('generated', blockId, artifact)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}

function reportRuntimeError(message: string) {
  if (!runtimeErrors.value.includes(message) && runtimeErrors.value.length < 10) runtimeErrors.value.push(message)
  if (runtimeErrors.value.length === 1) window.setTimeout(() => void generate([...runtimeErrors.value]), 1500)
}
</script>

<template>
  <section class="card card-border bg-base-100 shadow-sm">
    <div class="flex min-h-10 items-center gap-2 border-b border-base-300 px-3">
      <span class="badge badge-primary badge-sm">intaged</span>
      <span
        v-if="busy"
        class="text-xs opacity-60"
      >Generating…</span>
      <span
        v-else-if="stale"
        class="text-xs text-warning"
      >Out of date</span>
      <div class="flex-1" />
      <button
        class="btn btn-square btn-ghost btn-sm"
        :disabled="busy || !spec.trim()"
        :title="artifact ? 'Regenerate' : 'Generate'"
        @click="generate()"
      >
        <span
          v-if="busy"
          class="loading loading-spinner loading-xs"
        />
        <RefreshCw
          v-else-if="artifact"
          :size="16"
        />
        <WandSparkles
          v-else
          :size="16"
        />
      </button>
    </div>
    <div class="p-2">
      <WidgetFrame
        v-if="artifact"
        :artifact="artifact"
        @error="reportRuntimeError"
      />
      <div
        v-else
        class="flex h-36 items-center justify-center rounded-box border-2 border-dashed border-base-300 text-sm opacity-50"
      >
        Not generated yet
      </div>
      <div
        v-if="error"
        role="alert"
        class="alert alert-error alert-soft mt-2 py-2 text-sm"
      >
        <TriangleAlert :size="16" />
        <span>{{ error }}</span>
      </div>
    </div>
  </section>
</template>
