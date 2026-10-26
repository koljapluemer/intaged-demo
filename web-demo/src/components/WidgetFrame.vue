<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WidgetArtifact } from '../types'
import { buildWidgetDocument, isWidgetMessage } from '../widgetFrame'

const props = defineProps<{ artifact: WidgetArtifact }>()
const emit = defineEmits<{ error: [message: string] }>()
const frame = ref<HTMLIFrameElement>()
const height = ref(160)
const srcdoc = ref('')

watch(
  () => props.artifact,
  async (artifact) => {
    try {
      srcdoc.value = await buildWidgetDocument(artifact)
    } catch (error) {
      emit('error', error instanceof Error ? error.message : String(error))
    }
  },
  { immediate: true },
)

function onMessage(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || !isWidgetMessage(event.data)) return
  if (event.data.type === 'resize' && event.data.height) height.value = Math.max(event.data.height, 60)
  if (event.data.type === 'error' && event.data.message) emit('error', event.data.message)
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <iframe
    ref="frame"
    sandbox="allow-scripts"
    :srcdoc="srcdoc"
    title="Generated widget"
    class="block w-full rounded-box"
    :style="{ height: `${height}px` }"
  />
</template>
