<script setup lang="ts">
import { FileText, Plus } from '@lucide/vue'
import { ref } from 'vue'
import type { DocInfo } from '../api'
import NewDocDialog from './NewDocDialog.vue'

defineProps<{ docs: DocInfo[]; current: string | null }>()
const emit = defineEmits<{ select: [name: string]; create: [name: string] }>()

const dialog = ref<InstanceType<typeof NewDocDialog>>()
</script>

<template>
  <aside class="min-h-full w-64 border-r border-base-300 bg-base-200">
    <div class="flex items-center justify-between px-4 py-2">
      <span class="font-bold">intaged</span>
      <button
        class="btn btn-square btn-ghost btn-sm"
        title="New document"
        @click="dialog?.open()"
      >
        <Plus :size="16" />
      </button>
    </div>
    <ul class="menu w-full">
      <li
        v-for="doc in docs"
        :key="doc.name"
      >
        <a
          :class="{ 'menu-active': doc.name === current }"
          @click="emit('select', doc.name)"
        >
          <FileText :size="14" />
          {{ doc.name }}
        </a>
      </li>
    </ul>
    <NewDocDialog
      ref="dialog"
      @create="emit('create', $event)"
    />
  </aside>
</template>
