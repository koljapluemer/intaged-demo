<script setup lang="ts">
import { BookOpen, Check, Copy, FileText, PencilLine } from '@lucide/vue'
import { ref, watch } from 'vue'
import { createShare, type ShareAccess } from '../api'
import { shareUrl, t } from '../i18n'

type Choice = 'edit' | ShareAccess

const props = defineProps<{ documentId: string }>()

const dialog = ref<HTMLDialogElement | null>(null)
const choice = ref<Choice>('edit')
const link = ref('')
const creating = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)
// Tokens are stable per document and access level, so one request per level is enough.
const tokens = new Map<ShareAccess, string>()

const choices: { value: Choice; icon: typeof PencilLine }[] = [
  { value: 'edit', icon: PencilLine },
  { value: 'spec', icon: FileText },
  { value: 'reader', icon: BookOpen },
]

async function updateLink(value: Choice) {
  error.value = null
  copied.value = false
  if (value === 'edit') {
    creating.value = false
    link.value = shareUrl()
    return
  }
  link.value = ''
  creating.value = true
  try {
    const token = tokens.get(value) ?? (await createShare(props.documentId, value))
    tokens.set(value, token)
    if (choice.value === value) link.value = shareUrl(`/s/${encodeURIComponent(token)}`)
  } catch (reason) {
    if (choice.value === value) error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (choice.value === value) creating.value = false
  }
}

watch(choice, updateLink)

function open() {
  void updateLink(choice.value)
  dialog.value?.showModal()
}

async function copy() {
  if (!link.value) return
  await navigator.clipboard.writeText(link.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

defineExpose({ open })
</script>

<template>
  <dialog
    ref="dialog"
    class="modal"
  >
    <div class="modal-box">
      <h3 class="text-lg font-bold">
        {{ t('share.title') }}
      </h3>
      <div
        class="mt-4 flex flex-col gap-2"
        role="radiogroup"
      >
        <label
          v-for="option in choices"
          :key="option.value"
          class="flex cursor-pointer items-start gap-3 rounded-box border p-3"
          :class="choice === option.value ? 'border-primary bg-primary/5' : 'border-base-300'"
        >
          <input
            v-model="choice"
            type="radio"
            name="share-access"
            class="radio radio-primary radio-sm mt-0.5"
            :value="option.value"
          >
          <component
            :is="option.icon"
            :size="18"
            class="mt-0.5 shrink-0 opacity-70"
          />
          <span class="flex flex-col">
            <span class="font-medium">{{ t(`share.${option.value}`) }}</span>
            <span class="text-sm opacity-60">{{ t(`share.${option.value}Hint`) }}</span>
          </span>
        </label>
      </div>
      <div
        v-if="error"
        role="alert"
        class="alert alert-error mt-4 py-2 text-sm"
      >
        {{ error }}
      </div>
      <div class="mt-4 join w-full">
        <input
          class="input join-item w-full"
          readonly
          :aria-label="t('share.link')"
          :value="creating ? t('share.creating') : link"
          @focus="($event.target as HTMLInputElement).select()"
        >
        <button
          class="btn btn-primary join-item"
          :disabled="!link || creating"
          @click="copy"
        >
          <span
            v-if="creating"
            class="loading loading-spinner loading-xs"
          />
          <Check
            v-else-if="copied"
            :size="16"
          />
          <Copy
            v-else
            :size="16"
          />
          {{ copied ? t('share.copied') : t('share.copy') }}
        </button>
      </div>
      <div class="modal-action">
        <form method="dialog">
          <button class="btn btn-ghost btn-sm">
            {{ t('share.close') }}
          </button>
        </form>
      </div>
    </div>
    <form
      method="dialog"
      class="modal-backdrop"
    >
      <button>{{ t('share.close') }}</button>
    </form>
  </dialog>
</template>
