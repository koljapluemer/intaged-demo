import { shallowReactive } from 'vue'
import { getWidget } from './api'
import type { WidgetArtifact } from './types'

const artifacts = shallowReactive(new Map<string, WidgetArtifact | null>())
const requests = new Map<string, Promise<WidgetArtifact | null>>()

export function cachedArtifact(revision: string): WidgetArtifact | null | undefined {
  return artifacts.get(revision)
}

export function loadArtifact(revision: string): Promise<WidgetArtifact | null> {
  let request = requests.get(revision)
  if (!request) {
    request = getWidget(revision)
      .catch(() => null)
      .then((value) => {
        artifacts.set(revision, value)
        return value
      })
    requests.set(revision, request)
  }
  return request
}

export function storeArtifact(artifact: WidgetArtifact) {
  artifacts.set(artifact.id, artifact)
  requests.set(artifact.id, Promise.resolve(artifact))
}
