import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writeFileAtomic } from './artifacts.js'

export const SHARE_ACCESS = ['spec', 'reader'] as const
export type ShareAccess = (typeof SHARE_ACCESS)[number]

const shareSchema = z.object({ token: z.string(), documentId: z.string(), access: z.enum(SHARE_ACCESS) })
const registrySchema = z.array(shareSchema)
type Share = z.infer<typeof shareSchema>

/**
 * Read-only links. A token stands in for the document ID, which grants edit access to anyone who
 * knows it, so read-only viewers never learn the ID.
 */
export class ShareRegistry {
  private readonly byToken = new Map<string, Share>()
  // Serializes writes so concurrent creations never overwrite each other.
  private writing = Promise.resolve()

  constructor(private readonly file: string) {}

  async initialize() {
    try {
      for (const share of registrySchema.parse(JSON.parse(await readFile(this.file, 'utf8')))) this.byToken.set(share.token, share)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  get(token: string): Omit<Share, 'token'> | undefined {
    const share = this.byToken.get(token)
    return share && { documentId: share.documentId, access: share.access }
  }

  /** Returns the existing token for this document and access level, or creates one. */
  async create(documentId: string, access: ShareAccess): Promise<string> {
    for (const share of this.byToken.values()) {
      if (share.documentId === documentId && share.access === access) {
        await this.writing
        return share.token
      }
    }
    const token = randomBytes(24).toString('base64url')
    this.byToken.set(token, { token, documentId, access })
    this.writing = this.writing.then(() => writeFileAtomic(this.file, `${JSON.stringify([...this.byToken.values()])}\n`))
    await this.writing
    return token
  }
}

const WIDGET_FENCE = /^(```intaged[^\n]*\n)[\s\S]*?^(```[ \t]*)$/gm

/** Drops the spec text from every widget block, keeping the fences and their block IDs. */
export function redactSpecs(markdown: string): string {
  return markdown.replace(WIDGET_FENCE, '$1$2')
}
