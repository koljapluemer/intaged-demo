import JSZip from 'jszip'
import { getBundle, getWidget } from './api'
import { titleFromMarkdown } from './document'
import { findWidgetBlocks } from './widgetBlocks'
import type { TheadocDocument } from './types'

export function exportedMarkdown(document: TheadocDocument) {
  const blocks = findWidgetBlocks(document.markdown)
  let markdown = document.markdown
  for (const block of [...blocks].reverse()) {
    if (!block.blockId) continue
    const revision = document.widgets[block.blockId]?.selectedRevision
    if (!revision) continue
    const opening = markdown.slice(block.from, block.infoTo)
    markdown = `${markdown.slice(0, block.from)}${opening} rev=${revision}${markdown.slice(block.infoTo)}`
  }
  return markdown
}

function filename(markdown: string) {
  const slug = titleFromMarkdown(markdown)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'document'}.theadoc.zip`
}

export async function downloadBundle(documentId: string, theadoc: TheadocDocument) {
  const revisions = [...new Set(Object.values(theadoc.widgets).flatMap((widget) => widget.selectedRevision ?? []))]
  const artifacts = await Promise.all(revisions.map(getWidget))
  const hashes = [...new Set(artifacts.map((artifact) => artifact.bundle))]
  const bundles = await Promise.all(hashes.map(getBundle))
  const zip = new JSZip()
  zip.file('document.md', exportedMarkdown(theadoc))
  zip.file(
    'manifest.json',
    `${JSON.stringify({ bundleVersion: 2, documentId, exportedAt: new Date().toISOString(), revisions }, null, 2)}\n`,
  )
  for (const artifact of artifacts) zip.file(`widgets/${artifact.id}.json`, `${JSON.stringify(artifact, null, 2)}\n`)
  hashes.forEach((hash, index) => zip.file(`bundles/${hash}.json`, JSON.stringify(bundles[index])))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename(theadoc.markdown)
  link.click()
  URL.revokeObjectURL(link.href)
}
