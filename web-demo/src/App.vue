<script setup lang="ts">
import type { DocHandle } from '@automerge/automerge-repo'
import { FilePlus2, FileText, Link2 } from '@lucide/vue'
import { onMounted, ref, shallowRef } from 'vue'
import DocumentView from './components/DocumentView.vue'
import { documentIdFromUrl, documentUrlFromId, NEW_DOCUMENT } from './document'
import { readRecentDocuments, rememberDocument, type RecentDocument } from './recentDocs'
import { repo } from './repo'
import type { TheadocDocument } from './types'

const handle = shallowRef<DocHandle<TheadocDocument> | null>(null)
const documentId = ref<string | null>(null)
const recent = ref<RecentDocument[]>(readRecentDocuments())
const loading = ref(false)
const error = ref<string | null>(null)
function routeId() {
  const match = location.pathname.match(/^\/d\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

async function openDocument(id: string, push = true) {
  loading.value = true
  error.value = null
  try {
    const next = await repo.find<TheadocDocument>(documentUrlFromId(id))
    await next.whenReady()
    handle.value = next
    documentId.value = id
    if (push) history.pushState({}, '', `/d/${encodeURIComponent(id)}`)
    updateRecent(next.doc().markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Untitled')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

function createDocument() {
  const next = repo.create<TheadocDocument>(structuredClone(NEW_DOCUMENT))
  const id = documentIdFromUrl(next.url)
  handle.value = next
  documentId.value = id
  history.pushState({}, '', `/d/${encodeURIComponent(id)}`)
  updateRecent('Untitled')
}

function updateRecent(title: string) {
  if (!documentId.value) return
  rememberDocument({ id: documentId.value, title, openedAt: Date.now() })
  recent.value = readRecentDocuments()
}

function openLink() {
  const value = window.prompt('Paste a theadoc link or document ID')?.trim()
  if (!value) return
  try {
    const url = new URL(value, location.origin)
    const match = url.pathname.match(/^\/d\/([^/]+)$/)
    void openDocument(match?.[1] ? decodeURIComponent(match[1]) : value)
  } catch {
    void openDocument(value)
  }
}

window.addEventListener('popstate', () => {
  const id = routeId()
  if (id) void openDocument(id, false)
  else {
    handle.value = null
    documentId.value = null
  }
})

onMounted(() => {
  const id = routeId()
  if (id) void openDocument(id, false)
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
      <DocumentView
        v-if="handle && documentId"
        :key="documentId"
        :handle="handle"
        :document-id="documentId"
        @title="updateRecent"
      />
      <div
        v-else
        class="flex h-full items-center justify-center p-6"
      >
        <div class="w-full max-w-md">
          <h1 class="text-3xl font-bold">
            theadoc
          </h1>
          <p class="mt-2 text-base-content/60">
            Collaborative documents with generated widgets.
          </p>
          <div
            v-if="error"
            role="alert"
            class="alert alert-error mt-6 text-sm"
          >
            {{ error }}
          </div>
          <div class="mt-8 flex gap-2">
            <button
              class="btn btn-primary"
              :disabled="loading"
              @click="createDocument"
            >
              <FilePlus2 :size="17" /> New document
            </button>
            <button
              class="btn btn-ghost"
              :disabled="loading"
              @click="openLink"
            >
              <Link2 :size="17" /> Open link
            </button>
          </div>
        </div>
      </div>
    </main>
    <aside class="drawer-side z-20">
      <label
        for="drawer"
        class="drawer-overlay"
      />
      <div class="flex min-h-full w-72 flex-col border-r border-base-300 bg-base-200 p-3">
        <div class="flex items-center gap-2 px-2 py-3">
          <span class="text-lg font-bold">theadoc</span>
          <div class="flex-1" />
          <button
            class="btn btn-square btn-primary btn-sm"
            title="New document"
            @click="createDocument"
          >
            <FilePlus2 :size="17" />
          </button>
        </div>
        <nav class="menu w-full gap-1 p-0">
          <button
            v-for="item in recent"
            :key="item.id"
            class="flex min-w-0 items-center gap-2"
            :class="{ 'menu-active': item.id === documentId }"
            @click="openDocument(item.id)"
          >
            <FileText :size="16" />
            <span class="truncate">{{ item.title }}</span>
          </button>
        </nav>
        <p
          v-if="!recent.length"
          class="px-2 py-4 text-sm opacity-50"
        >
          No recent documents
        </p>
        <div class="flex-1" />
        <button
          class="btn btn-ghost btn-sm justify-start"
          @click="openLink"
        >
          <Link2 :size="16" /> Open shared link
        </button>
      </div>
    </aside>
  </div>
</template>
