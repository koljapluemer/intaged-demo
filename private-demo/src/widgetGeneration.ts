import { reactive } from 'vue'
import { generateWidget, type GenerateWidgetInput } from './api'
import type { WidgetArtifact } from './types'

interface Generation {
  busy: boolean
  error: string | null
}

// Shared by a block's controls and its rendered view, which are separate editor widgets that get recreated mid-request.
const generations = reactive(new Map<string, Generation>())

export function generation(blockId: string | null): Generation | undefined {
  return blockId ? generations.get(blockId) : undefined
}

export async function runGeneration(input: GenerateWidgetInput, onGenerated: (artifact: WidgetArtifact) => void) {
  if (generations.get(input.blockId)?.busy) return
  generations.set(input.blockId, { busy: true, error: null })
  try {
    const artifact = await generateWidget(input)
    generations.delete(input.blockId)
    onGenerated(artifact)
  } catch (reason) {
    generations.set(input.blockId, { busy: false, error: reason instanceof Error ? reason.message : String(reason) })
  }
}
