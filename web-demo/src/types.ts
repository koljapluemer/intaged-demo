// Hosts a widget may opt into for map tiles and similar assets; everything else stays blocked by the iframe CSP.
export const NETWORK_HOSTS = ['tile.openstreetmap.org', 'tiles.openfreemap.org', 'basemaps.cartocdn.com'] as const

export type NetworkHost = (typeof NETWORK_HOSTS)[number]

export interface WidgetSource {
  files: Record<string, string>
  deps: Record<string, string>
  network: NetworkHost[]
}

export interface WidgetArtifact extends WidgetSource {
  schemaVersion: 2
  id: string
  documentId: string
  blockId: string
  spec: string
  specHash: string
  model: string
  generatorVersion: string
  createdAt: string
  bundle: string
}

export interface WidgetBundle {
  js: string
  css: string
}

export type GenerationJob =
  | { id: string; status: 'running'; stage: string }
  | { id: string; status: 'done'; artifact: WidgetArtifact }
  | { id: string; status: 'failed'; error: string }

export interface TheadocDocument {
  schemaVersion: 1
  markdown: string
  widgets: Record<string, { selectedRevision?: string }>
}
