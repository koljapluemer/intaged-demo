<script setup lang="ts">
import { currentLocale, LOCALES, setLocale, t } from '../i18n'
</script>

<template>
  <div
    class="join"
    role="group"
    :aria-label="t('app.language')"
  >
    <button
      v-for="locale in LOCALES"
      :key="locale"
      class="btn join-item btn-xs uppercase"
      :class="locale === currentLocale() ? 'btn-active' : 'btn-ghost'"
      :aria-pressed="locale === currentLocale()"
      @click="setLocale(locale)"
    >
      {{ locale }}
    </button>
  </div>
</template>
