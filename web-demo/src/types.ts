export const LIB_NAMES = ['leaflet', 'd3', 'chartjs', 'three', 'svgjs', 'lucide'] as const

export type LibName = (typeof LIB_NAMES)[number]

export interface WidgetCode {
  html: string
  css: string
  js: string
  libs: LibName[]
}

export interface WidgetArtifact extends WidgetCode {
  id: string
  documentId: string
  blockId: string
  spec: string
  specHash: string
  model: string
  generatorVersion: string
  createdAt: string
}

export interface TheadocDocument {
  schemaVersion: 1
  markdown: string
  widgets: Record<string, { selectedRevision?: string }>
}
