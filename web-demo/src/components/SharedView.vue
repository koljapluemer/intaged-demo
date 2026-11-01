<script setup lang="ts">
import { Menu } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { subscribeShared, type SharedDocument } from '../api'
import { titleFromMarkdown } from '../document'
import { t } from '../i18n'
import DocumentReader from './DocumentReader.vue'
import LocaleToggle from './LocaleToggle.vue'

const props = defineProps<{ token: string; initial: SharedDocument }>()
const emit = defineEmits<{ title: [value: string] }>()

// Read-only viewers never join Automerge sync; the server streams the document instead.
const shared = ref<SharedDocument>(props.initial)
const title = computed(() => titleFromMarkdown(shared.value.document.markdown))
const stop = subscribeShared(props.token, (next) => (shared.value = next))
onBeforeUnmount(stop)
watch(title, (value) => emit('title', value))
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="navbar min-h-12 border-b border-base-300 px-3">
      <label
        v-if="shared.access === 'spec'"
        for="drawer"
        class="btn btn-square btn-ghost btn-sm lg:hidden"
      ><Menu :size="17" /></label>
      <h1 class="flex-1 truncate px-2 font-semibold">
        {{ title }}
      </h1>
      <span class="badge badge-ghost badge-sm">{{ t('shared.readOnly') }}</span>
      <LocaleToggle class="ml-2" />
    </header>
    <DocumentReader
      :document="shared.document"
      :show-spec="shared.access === 'spec'"
      class="min-h-0 flex-1"
    />
  </div>
</template>
