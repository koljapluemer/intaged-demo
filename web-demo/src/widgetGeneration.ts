import { reactive } from 'vue'
import { generateWidget, type GenerateWidgetInput } from './api'
import { t } from './i18n'
import type { WidgetArtifact } from './types'

interface Generation {
  busy: boolean
  stage: string | null
  error: string | null
}

// Shared by a block's controls and its rendered view, which are separate editor widgets that get recreated mid-request.
const generations = reactive(new Map<string, Generation>())
// Consecutive automatic repairs per block, so a widget that keeps failing at runtime cannot loop forever.
const autoRepairs = new Map<string, number>()
const MAX_AUTO_REPAIRS = 2

export function generation(blockId: string | null): Generation | undefined {
  return blockId ? generations.get(blockId) : undefined
}

export async function runGeneration(input: GenerateWidgetInput, onGenerated: (artifact: WidgetArtifact) => void) {
  if (generations.get(input.blockId)?.busy) return
  if (input.errors?.length) {
    const attempts = autoRepairs.get(input.blockId) ?? 0
    if (attempts >= MAX_AUTO_REPAIRS) {
      generations.set(input.blockId, {
        busy: false,
        stage: null,
        error: t('widget.stillFails', { error: input.errors[0] }),
      })
      return
    }
    autoRepairs.set(input.blockId, attempts + 1)
  } else {
    autoRepairs.delete(input.blockId)
  }
  generations.set(input.blockId, { busy: true, stage: null, error: null })
  try {
    const artifact = await generateWidget(input, (stage) => {
      const current = generations.get(input.blockId)
      if (current) current.stage = stage
    })
    generations.delete(input.blockId)
    onGenerated(artifact)
  } catch (reason) {
    generations.set(input.blockId, {
      busy: false,
      stage: null,
      error: reason instanceof Error ? reason.message : String(reason),
    })
  }
}
