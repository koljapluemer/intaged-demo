<script setup lang="ts">
import type { DocHandle } from '@automerge/automerge-repo'
import { FilePlus2, FileText, Link2 } from '@lucide/vue'
import { onMounted, ref, shallowRef } from 'vue'
import { captureAdminLink, clearAdminToken, readAdminToken } from './admin'
import { fetchShared, HttpError, registerDocument, type SharedDocument } from './api'
import DocumentView from './components/DocumentView.vue'
import LocaleToggle from './components/LocaleToggle.vue'
import SharedView from './components/SharedView.vue'
import { documentIdFromUrl, documentUrlFromId, NEW_DOCUMENT, titleFromMarkdown } from './document'
import { syncLocale, t, withLocale } from './i18n'
import { readRecentDocuments, rememberDocument, type RecentDocument } from './recentDocs'
import { repo } from './repo'
import type { TheadocDocument } from './types'

captureAdminLink()
syncLocale()

const adminToken = ref(readAdminToken())
const handle = shallowRef<DocHandle<TheadocDocument> | null>(null)
const documentId = ref<string | null>(null)
const shared = shallowRef<{ token: string; data: SharedDocument } | null>(null)
const recent = ref<RecentDocument[]>(readRecentDocuments())
const loading = ref(false)
const error = ref<string | null>(null)
type Route = { kind: 'document' | 'shared'; id: string }

/** `/d/<id>` opens a document for editing, `/s/<token>` a read-only shared link. */
function parseRoute(pathname: string): Route | null {
  const match = pathname.match(/^\/([ds])\/([^/]+)$/)
  if (!match?.[2]) return null
  return { kind: match[1] === 's' ? 'shared' : 'document', id: decodeURIComponent(match[2]) }
}

function openRoute(route: Route, push = true) {
  return route.kind === 'shared' ? openShared(route.id, push) : openDocument(route.id, push)
}

function closeDocument() {
  handle.value = null
  documentId.value = null
  shared.value = null
}

async function openShared(token: string, push = true) {
  loading.value = true
  error.value = null
  try {
    const data = await fetchShared(token)
    closeDocument()
    shared.value = { token, data }
    if (push) history.pushState({}, '', withLocale(`/s/${encodeURIComponent(token)}`))
    // Only spec links keep the sidebar, so reader links are not remembered there.
    if (data.access === 'spec') updateShared(titleFromMarkdown(data.document.markdown))
  } catch (reason) {
    closeDocument()
    error.value = reason instanceof HttpError && reason.status === 404 ? t('shared.notFound') : reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

function updateShared(title: string) {
  if (!shared.value || shared.value.data.access !== 'spec') return
  rememberDocument({ id: shared.value.token, title, openedAt: Date.now(), shared: true })
  recent.value = readRecentDocuments()
}

async function openDocument(id: string, push = true) {
  loading.value = true
  error.value = null
  try {
    const next = await repo.find<TheadocDocument>(documentUrlFromId(id))
    await next.whenReady()
    shared.value = null
    handle.value = next
    documentId.value = id
    if (push) history.pushState({}, '', withLocale(`/d/${encodeURIComponent(id)}`))
    updateRecent(titleFromMarkdown(next.doc().markdown))
    // Opening a document as admin registers it, which also covers documents created before registration.
    if (adminToken.value) void registerDocument(id, adminToken.value).catch(() => undefined)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function createDocument() {
  if (!adminToken.value) return
  loading.value = true
  error.value = null
  const next = repo.create<TheadocDocument>({
    ...structuredClone(NEW_DOCUMENT),
    markdown: `# ${t('app.untitled')}\n\n${t('app.startWriting')}\n`,
  })
  const id = documentIdFromUrl(next.url)
  try {
    await registerDocument(id, adminToken.value)
  } catch (reason) {
    if (reason instanceof HttpError && reason.status === 401) {
      clearAdminToken()
      adminToken.value = null
      error.value = t('app.adminRejected')
    } else {
      error.value = reason instanceof Error ? reason.message : String(reason)
    }
    repo.delete(next.url)
    return
  } finally {
    loading.value = false
  }
  shared.value = null
  handle.value = next
  documentId.value = id
  history.pushState({}, '', withLocale(`/d/${encodeURIComponent(id)}`))
  updateRecent(t('app.untitled'))
}

function updateRecent(title: string) {
  if (!documentId.value) return
  rememberDocument({ id: documentId.value, title, openedAt: Date.now() })
  recent.value = readRecentDocuments()
}

function openLink() {
  const value = window.prompt(t('app.pasteLink'))?.trim()
  if (!value) return
  try {
    const route = parseRoute(new URL(value, location.origin).pathname)
    void (route ? openRoute(route) : openDocument(value))
  } catch {
    void openDocument(value)
  }
}

function openRecent(item: RecentDocument) {
  void (item.shared ? openShared(item.id) : openDocument(item.id))
}

window.addEventListener('popstate', () => {
  const route = parseRoute(location.pathname)
  if (route) void openRoute(route, false)
  else closeDocument()
})

onMounted(() => {
  const route = parseRoute(location.pathname)
  if (route) void openRoute(route, false)
})
</script>

<template>
  <!-- Reader links show the rendered document alone, without the sidebar. -->
  <SharedView
    v-if="shared?.data.access === 'reader'"
    :key="shared.token"
    :token="shared.token"
    :initial="shared.data"
    class="h-screen"
  />
  <div
    v-else
    class="drawer h-screen lg:drawer-open"
  >
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
      <SharedView
        v-else-if="shared"
        :key="shared.token"
        :token="shared.token"
        :initial="shared.data"
        @title="updateShared"
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
            {{ t('app.tagline') }}
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
              v-if="adminToken"
              class="btn btn-primary"
              :disabled="loading"
              @click="createDocument"
            >
              <FilePlus2 :size="17" /> {{ t('app.newDocument') }}
            </button>
            <button
              class="btn btn-ghost"
              :disabled="loading"
              @click="openLink"
            >
              <Link2 :size="17" /> {{ t('app.openLink') }}
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
            v-if="adminToken"
            class="btn btn-square btn-primary btn-sm"
            :title="t('app.newDocument')"
            :disabled="loading"
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
            :class="{ 'menu-active': item.shared ? item.id === shared?.token : item.id === documentId }"
            @click="openRecent(item)"
          >
            <FileText :size="16" />
            <span class="truncate">{{ item.title }}</span>
          </button>
        </nav>
        <p
          v-if="!recent.length"
          class="px-2 py-4 text-sm opacity-50"
        >
          {{ t('app.noRecent') }}
        </p>
        <div class="flex-1" />
        <button
          class="btn btn-ghost btn-sm justify-start"
          @click="openLink"
        >
          <Link2 :size="16" /> {{ t('app.openSharedLink') }}
        </button>
        <div class="flex justify-end px-2 pt-2">
          <LocaleToggle />
        </div>
      </div>
    </aside>
  </div>
</template>
