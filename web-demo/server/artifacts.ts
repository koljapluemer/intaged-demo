import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { LIB_NAMES, type WidgetArtifact, type WidgetCode } from '../src/types.js'

export const revisionId = z.string().regex(/^w_[0-9a-f-]{36}$/)

const artifactSchema = z.object({
  id: revisionId,
  documentId: z.string().min(1),
  blockId: z.string().min(1),
  spec: z.string(),
  specHash: z.string(),
  model: z.string(),
  generatorVersion: z.string(),
  createdAt: z.string(),
  html: z.string(),
  css: z.string(),
  js: z.string(),
  libs: z.array(z.enum(LIB_NAMES)),
})

export class ArtifactStore {
  constructor(private readonly directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true })
  }

  async save(metadata: Omit<WidgetArtifact, keyof WidgetCode | 'id' | 'createdAt'>, code: WidgetCode) {
    const artifact: WidgetArtifact = {
      ...metadata,
      ...code,
      id: `w_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    }
    const target = this.file(artifact.id)
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(`${JSON.stringify(artifact)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    return artifact
  }

  async get(id: string): Promise<WidgetArtifact | null> {
    if (!revisionId.safeParse(id).success) return null
    try {
      return artifactSchema.parse(JSON.parse(await readFile(this.file(id), 'utf8')))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return null
      throw error
    }
  }

  private file(id: string) {
    return path.join(this.directory, `${id}.json`)
  }
}
