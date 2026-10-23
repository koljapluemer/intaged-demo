import { describe, expect, it } from 'vitest'
import { findWidgetBlocks, withBlockId } from './widgetBlocks'

describe('widget blocks', () => {
  it('parses widget specifications and IDs', () => {
    const markdown = '# Demo\n\n```intaged id=123e4567-e89b-12d3-a456-426614174000\nA chart.\n```\n'
    expect(findWidgetBlocks(markdown)).toMatchObject([
      { blockId: '123e4567-e89b-12d3-a456-426614174000', spec: 'A chart.' },
    ])
  })

  it('adds an ID to a draft fence', () => {
    const markdown = '```intaged\nA map.\n```'
    const block = findWidgetBlocks(markdown)[0]
    expect(block).toBeDefined()
    if (!block) throw new Error('expected a widget block')
    expect(withBlockId(markdown, block, '123e4567-e89b-12d3-a456-426614174000')).toContain(
      '```intaged id=123e4567-e89b-12d3-a456-426614174000',
    )
  })
})
