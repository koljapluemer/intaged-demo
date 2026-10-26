import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { NETWORK_HOSTS, type WidgetArtifact, type WidgetSource } from '../src/types.js'

export const revisionId = z.string().regex(/^w_[0-9a-f-]{36}$/)
export const bundleHash = z.string().regex(/^[0-9a-f]{64}$/)

const artifactSchema = z.object({
  schemaVersion: z.literal(2),
  id: revisionId,
  documentId: z.string().min(1),
  blockId: z.string().min(1),
  spec: z.string(),
  specHash: z.string(),
  model: z.string(),
  generatorVersion: z.string(),
  createdAt: z.string(),
  files: z.record(z.string(), z.string()),
  deps: z.record(z.string(), z.string()),
  network: z.array(z.enum(NETWORK_HOSTS)),
  bundle: bundleHash,
})

export async function writeFileAtomic(target: string, contents: string) {
  const temporary = `${target}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(contents)
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
}

export class ArtifactStore {
  constructor(private readonly directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true })
  }

  async save(
    metadata: Omit<WidgetArtifact, keyof WidgetSource | 'schemaVersion' | 'id' | 'createdAt' | 'bundle'>,
    source: WidgetSource,
    bundle: string,
  ) {
    const artifact: WidgetArtifact = {
      schemaVersion: 2,
      ...metadata,
      ...source,
      bundle,
      id: `w_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    }
    await writeFileAtomic(this.file(artifact.id), `${JSON.stringify(artifact)}\n`)
    return artifact
  }

  // Legacy (v1) and unreadable revisions resolve to null so the client offers a fresh render.
  async get(id: string): Promise<WidgetArtifact | null> {
    if (!revisionId.safeParse(id).success) return null
    try {
      const parsed = artifactSchema.safeParse(JSON.parse(await readFile(this.file(id), 'utf8')))
      return parsed.success ? parsed.data : null
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  private file(id: string) {
    return path.join(this.directory, `${id}.json`)
  }
}
