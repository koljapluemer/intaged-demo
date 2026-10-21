<script setup lang="ts">
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { RefreshCw, TriangleAlert, WandSparkles } from '@lucide/vue'
import { computed, ref } from 'vue'
import { INTAGED_LANGUAGE } from './CodeBlockWithWidgets'
import { useWidget } from './useWidget'
import WidgetFrame from './WidgetFrame.vue'

const props = defineProps(nodeViewProps)

const isWidget = computed(() => props.node.attrs.language === INTAGED_LANGUAGE)
const spec = computed(() => props.node.textContent)

// Document name + index among widget blocks.
function slot(): string {
  const pos = props.getPos() ?? 0
  let index = 0
  props.editor.state.doc.descendants((node, p) => {
    if (p < pos && node.type.name === 'codeBlock' && node.attrs.language === INTAGED_LANGUAGE) index++
  })
  return `${props.extension.options.docName}:${index}`
}

const { code, status, busy, stale, requestError, runtimeErrors, renderId, generate, reportError } =
  useWidget(spec, isWidget, slot)

type View = 'spec' | 'render' | 'both'
const tabs: { value: View; label: string }[] = [
  { value: 'spec', label: 'Spec' },
  { value: 'render', label: 'Rendered' },
  { value: 'both', label: 'Both' },
]
const view = ref<View>('both')
</script>

<template>
  <!-- One NodeViewContent in a fixed position: Tiptap requires the content element to stay stable. -->
  <NodeViewWrapper :class="{ 'not-prose card card-border my-4 bg-base-100': isWidget }">
    <div
      v-if="isWidget"
      contenteditable="false"
      class="flex items-center gap-2 border-b border-base-300 px-3 py-1"
    >
      <span class="badge badge-primary badge-sm">intaged</span>
      <div
        role="tablist"
        class="tabs tabs-box tabs-xs"
      >
        <button
          v-for="t in tabs"
          :key="t.value"
          role="tab"
          class="tab"
          :class="{ 'tab-active': view === t.value }"
          @click="view = t.value"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="flex-1" />
      <span
        v-if="busy"
        class="text-xs opacity-60"
      >{{ status === 'repairing' ? 'Fixing errors…' : 'Generating…' }}</span>
      <span
        v-else-if="stale"
        class="text-xs text-warning"
      >Spec changed</span>
      <button
        class="btn btn-square btn-ghost btn-xs"
        :disabled="busy || !spec.trim()"
        :title="code ? 'Regenerate' : 'Generate'"
        @click="generate()"
      >
        <span
          v-if="busy"
          class="loading loading-xs loading-spinner"
        />
        <RefreshCw
          v-else-if="code"
          :size="14"
        />
        <WandSparkles
          v-else
          :size="14"
        />
      </button>
    </div>

    <pre
      v-show="!isWidget || view !== 'render'"
      :class="{ 'm-0 bg-transparent px-3 py-2 font-mono text-sm whitespace-pre-wrap text-base-content/80': isWidget }"
    ><NodeViewContent as="code" /></pre>

    <div
      v-if="isWidget"
      v-show="view !== 'spec'"
      contenteditable="false"
      class="flex flex-col gap-2 border-base-300 p-2"
      :class="{ 'border-t': view === 'both' }"
    >
      <WidgetFrame
        v-if="code"
        :key="renderId"
        :code="code"
        :class="{ 'opacity-40': busy }"
        @error="reportError"
      />
      <div
        v-else
        class="flex h-40 items-center justify-center rounded-field border-2 border-dashed border-base-300 text-sm opacity-50"
      >
        Not generated yet
      </div>

      <div
        v-if="requestError"
        role="alert"
        class="alert alert-error alert-soft py-2 text-sm"
      >
        <TriangleAlert :size="16" />
        <span>{{ requestError }}</span>
      </div>
      <div
        v-else-if="runtimeErrors.length && !busy"
        role="alert"
        class="alert alert-warning alert-soft items-start py-2"
      >
        <TriangleAlert :size="16" />
        <ul class="font-mono text-xs">
          <li
            v-for="err in runtimeErrors"
            :key="err"
          >
            {{ err }}
          </li>
        </ul>
      </div>
    </div>
  </NodeViewWrapper>
</template>
