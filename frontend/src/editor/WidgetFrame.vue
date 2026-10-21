<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { WidgetCode } from '../api'
import { buildSrcdoc, isFrameMessage } from '../widgetFrame'

const props = defineProps<{ code: WidgetCode }>()
const emit = defineEmits<{ error: [message: string] }>()

const frame = ref<HTMLIFrameElement>()
const height = ref(160)
const srcdoc = computed(() => buildSrcdoc(props.code))

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
    ref="frame"
    sandbox="allow-scripts"
    :srcdoc="srcdoc"
    :title="code.title"
    :style="{ height: `${height}px` }"
    class="block w-full rounded-field"
  />
</template>
