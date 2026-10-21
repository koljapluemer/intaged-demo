<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WidgetCode } from '../api'
import { buildSrcdoc, isFrameMessage } from '../widgetFrame'
import { loadLibs } from '../widgetLibs'

const props = defineProps<{ code: WidgetCode }>()
const emit = defineEmits<{ error: [message: string] }>()

const frame = ref<HTMLIFrameElement>()
const height = ref(160)
const srcdoc = ref<string>()

watch(
  () => props.code,
  async (code) => {
    try {
      srcdoc.value = buildSrcdoc(code, await loadLibs(code.libs ?? []))
    } catch (e) {
      emit('error', `Failed to load libraries: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
  { immediate: true },
)

function onMessage(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || !isFrameMessage(event.data)) return
  const { type, height: h, message } = event.data
  if (type === 'resize' && h) height.value = Math.min(Math.max(h, 60), 1200)
  if (type === 'error' && message) emit('error', message)
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <!-- No allow-same-origin: the widget can't touch the app, its storage or cookies. -->
  <iframe
    v-if="srcdoc"
    ref="frame"
    sandbox="allow-scripts"
    :srcdoc="srcdoc"
    title="Widget"
    :style="{ height: `${height}px` }"
    class="block w-full rounded-field"
  />
</template>
