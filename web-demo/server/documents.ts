import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writeFileAtomic } from './artifacts.js'

const registrySchema = z.array(z.string())

/** Documents created by the admin. Only these may generate widgets. */
export class DocumentRegistry {
  private readonly ids = new Set<string>()
  // Serializes writes so concurrent registrations never overwrite each other.
  private writing = Promise.resolve()

  constructor(private readonly file: string) {}

  async initialize() {
    try {
      for (const id of registrySchema.parse(JSON.parse(await readFile(this.file, 'utf8')))) this.ids.add(id)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  has(id: string) {
    return this.ids.has(id)
  }

  register(id: string) {
    if (this.ids.has(id)) return this.writing
    this.ids.add(id)
    this.writing = this.writing.then(() => writeFileAtomic(this.file, `${JSON.stringify([...this.ids])}\n`))
    return this.writing
  }
}
