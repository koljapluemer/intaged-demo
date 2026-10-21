import { computed, ref, watch, type Ref } from 'vue'
import { generateWidget, type WidgetCode } from '../api'
import { hashSpec, loadLastHash, loadWidget, saveLastHash, saveWidget } from '../widgetStore'

// How long to watch a freshly generated widget for runtime errors before auto-repairing.
const REPAIR_WINDOW_MS = 2000
const MAX_ERRORS = 10

/** Generation state of one widget block. `slot` identifies the block across reloads. */
export function useWidget(spec: Ref<string>, enabled: Ref<boolean>, slot: () => string) {
  const hash = computed(() => hashSpec(spec.value))
  const code = ref<WidgetCode | null>(null)
  const shownHash = ref<string | null>(null)
  const status = ref<'idle' | 'generating' | 'repairing'>('idle')
  const requestError = ref<string | null>(null)
  const runtimeErrors = ref<string[]>([])
  // Bumped on every render so the frame reloads even for identical code.
  const renderId = ref(0)

  const busy = computed(() => status.value !== 'idle')
  const stale = computed(() => code.value !== null && shownHash.value !== hash.value)

  function show(widget: WidgetCode, widgetHash: string) {
    code.value = widget
    shownHash.value = widgetHash
    runtimeErrors.value = []
    renderId.value++
  }

  function loadCached() {
    const cached = loadWidget(hash.value)
    if (cached) return show(cached, hash.value)
    const lastHash = loadLastHash(slot())
    const last = lastHash ? loadWidget(lastHash) : null
    if (lastHash && last) show(last, lastHash)
  }

  function reportError(message: string) {
    if (!runtimeErrors.value.includes(message) && runtimeErrors.value.length < MAX_ERRORS) {
      runtimeErrors.value.push(message)
    }
  }

  async function generate(repairErrors?: string[]) {
    const specText = spec.value
    const specHash = hash.value
    if (!specText.trim()) return

    // Pass the previous code when repairing or iterating on a changed spec;
    // regenerating the same spec starts fresh.
    const previous = repairErrors || stale.value ? (code.value ?? undefined) : undefined
    status.value = repairErrors ? 'repairing' : 'generating'
    requestError.value = null
    try {
      const widget = await generateWidget(specText, previous, repairErrors)
      saveWidget(specHash, widget)
      saveLastHash(slot(), specHash)
      show(widget, specHash)
    } catch (e) {
      requestError.value = e instanceof Error ? e.message : String(e)
      return
    } finally {
      status.value = 'idle'
    }

    if (!repairErrors) await repairIfBroken(specHash)
  }

  async function repairIfBroken(specHash: string) {
    await new Promise((resolve) => setTimeout(resolve, REPAIR_WINDOW_MS))
    if (runtimeErrors.value.length && shownHash.value === specHash && !busy.value) {
      await generate([...runtimeErrors.value])
    }
  }

  watch(enabled, (on) => on && !code.value && loadCached(), { immediate: true })

  // If the spec changes back to one we have code for (e.g. undo), show that code.
  watch(hash, (newHash) => {
    const cached = enabled.value && newHash !== shownHash.value ? loadWidget(newHash) : null
    if (cached) show(cached, newHash)
  })

  return { code, status, busy, stale, requestError, runtimeErrors, renderId, generate, reportError }
}
