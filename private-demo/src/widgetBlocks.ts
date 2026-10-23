export interface WidgetBlock {
  blockId: string | null
  from: number
  to: number
  infoFrom: number
  infoTo: number
  spec: string
}

const FENCE = /^```intaged(?:\s+id=([0-9a-f-]{36}))?[^\n]*\n([\s\S]*?)^```\s*$/gm

export function findWidgetBlocks(markdown: string): WidgetBlock[] {
  return [...markdown.matchAll(FENCE)].map((match) => {
    const from = match.index
    const openingEnd = markdown.indexOf('\n', from)
    return {
      blockId: match[1] ?? null,
      from,
      to: from + match[0].length,
      infoFrom: from + '```intaged'.length,
      infoTo: openingEnd,
      spec: (match[2] ?? '').trim(),
    }
  })
}

export function withBlockId(markdown: string, block: WidgetBlock, blockId: string): string {
  const opening = markdown.slice(block.from, block.infoTo)
  const nextOpening = opening.replace(/^```intaged[^\n]*$/, `\`\`\`intaged id=${blockId}`)
  return markdown.slice(0, block.from) + nextOpening + markdown.slice(block.infoTo)
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.trim()))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
