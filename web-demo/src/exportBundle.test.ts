import { describe, expect, it } from 'vitest'
import { exportedMarkdown } from './exportBundle'
import type { TheadocDocument } from './types'

describe('portable Markdown', () => {
  it('materializes selected revisions without changing the live document', () => {
    const markdown = '```intaged id=123e4567-e89b-12d3-a456-426614174000\nA chart.\n```'
    const document: TheadocDocument = {
      schemaVersion: 1,
      markdown,
      widgets: {
        '123e4567-e89b-12d3-a456-426614174000': { selectedRevision: 'w_revision' },
      },
    }
    expect(exportedMarkdown(document)).toContain('id=123e4567-e89b-12d3-a456-426614174000 rev=w_revision')
    expect(document.markdown).toBe(markdown)
  })
})
