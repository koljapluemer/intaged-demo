import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo'
import { t } from './i18n'
import type { TheadocDocument } from './types'

export const NEW_DOCUMENT: TheadocDocument = {
  schemaVersion: 1,
  markdown: '# Untitled\n\nStart writing.\n',
  widgets: {},
}

export function documentIdFromUrl(url: AutomergeUrl | string): string {
  return String(url).replace(/^automerge:/, '')
}

export function documentUrlFromId(id: string): AutomergeUrl {
  return `automerge:${id}` as AutomergeUrl
}

export function titleFromMarkdown(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || t('app.untitled')
}

export function selectRevision(handle: DocHandle<TheadocDocument>, blockId: string, revision: string) {
  handle.change((document) => {
    document.widgets[blockId] ??= {}
    document.widgets[blockId].selectedRevision = revision
  })
}
