<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listDocs, saveDoc, type DocInfo } from './api'
import DocEditor from './components/DocEditor.vue'
import DocList from './components/DocList.vue'

const docs = ref<DocInfo[]>([])
const current = ref<string | null>(null)

async function create(name: string) {
  if (!docs.value.some((d) => d.name === name)) await saveDoc(name, `# ${name}\n`)
  docs.value = await listDocs()
  current.value = name
}

onMounted(async () => {
  docs.value = await listDocs()
  current.value = docs.value[0]?.name ?? null
})
</script>

<template>
  <div class="drawer h-screen lg:drawer-open">
    <input
      id="drawer"
      type="checkbox"
      class="drawer-toggle"
    >
    <main class="drawer-content h-screen overflow-hidden">
      <!-- key: a fresh editor per document -->
      <DocEditor
        v-if="current"
        :key="current"
        :name="current"
      />
    </main>
    <div class="drawer-side">
      <label
        for="drawer"
        class="drawer-overlay"
      />
      <DocList
        :docs="docs"
        :current="current"
        @select="current = $event"
        @create="create"
      />
    </div>
  </div>
</template>
