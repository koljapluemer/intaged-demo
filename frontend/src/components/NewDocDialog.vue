<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ create: [name: string] }>()

const dialog = ref<HTMLDialogElement>()
const name = ref('')

function open() {
  name.value = ''
  dialog.value?.showModal()
}

function submit() {
  emit('create', name.value.trim())
  dialog.value?.close()
}

defineExpose({ open })
</script>

<template>
  <dialog
    ref="dialog"
    class="modal"
  >
    <form
      class="modal-box flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <h3 class="text-lg font-bold">
        New document
      </h3>
      <fieldset class="fieldset">
        <label
          for="doc-name"
          class="fieldset-legend"
        >Name</label>
        <input
          id="doc-name"
          v-model="name"
          class="input w-full"
          required
          pattern="[\w\-]+"
          autofocus
        >
        <p class="label">
          Letters, digits, - and _
        </p>
      </fieldset>
      <div class="modal-action">
        <button
          type="button"
          class="btn"
          @click="dialog?.close()"
        >
          Cancel
        </button>
        <button class="btn btn-primary">
          Create
        </button>
      </div>
    </form>
    <form
      method="dialog"
      class="modal-backdrop"
    >
      <button>close</button>
    </form>
  </dialog>
</template>
