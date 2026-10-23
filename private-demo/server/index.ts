import path from 'node:path'
import express from 'express'
import { z } from 'zod'
import { LIB_NAMES } from '../src/types.js'
import { ArtifactStore } from './artifacts.js'
import { config } from './config.js'
import { QueueFullError, WorkQueue } from './concurrency.js'
import { GENERATOR_VERSION, GenerationError, WidgetGenerator, hashSpec } from './generator.js'
import { startSyncServer } from './sync.js'

const staticDir = path.resolve('dist')
const store = new ArtifactStore(path.join(config.dataDir, 'widgets'))
const generator = new WidgetGenerator()
const queue = new WorkQueue(config.maxConcurrentGenerations, config.maxQueuedGenerations)

const generateSchema = z.object({
  documentId: z.string().min(1).max(500),
  blockId: z.string().uuid(),
  spec: z.string().trim().min(1).max(config.maxSpecLength),
  previousRevision: z.string().optional(),
  errors: z.array(z.string().max(2_000)).max(10).optional(),
})

await store.initialize()
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, generation: queue.stats })
})

app.get('/api/widgets/:revisionId', async (request, response, next) => {
  try {
    const artifact = await store.get(request.params.revisionId)
    if (!artifact) return response.status(404).json({ error: 'Widget revision not found' })
    response.set('Cache-Control', 'public, max-age=31536000, immutable').json(artifact)
  } catch (error) {
    next(error)
  }
})

app.post('/api/widgets/generate', async (request, response) => {
  const parsed = generateSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid generation request' })

  try {
    const previousArtifact = parsed.data.previousRevision
      ? await store.get(parsed.data.previousRevision)
      : null
    const code = await queue.run(() =>
      generator.generate({
        ...parsed.data,
        previous: previousArtifact
          ? {
              html: previousArtifact.html,
              css: previousArtifact.css,
              js: previousArtifact.js,
              libs: previousArtifact.libs.filter((lib): lib is (typeof LIB_NAMES)[number] =>
                LIB_NAMES.includes(lib),
              ),
            }
          : undefined,
      }),
    )
    const artifact = await store.save(
      {
        documentId: parsed.data.documentId,
        blockId: parsed.data.blockId,
        spec: parsed.data.spec,
        specHash: hashSpec(parsed.data.spec),
        model: config.model,
        generatorVersion: GENERATOR_VERSION,
      },
      code,
    )
    response.status(201).json(artifact)
  } catch (error) {
    if (error instanceof QueueFullError) return response.status(429).json({ error: 'Generation queue is full' })
    if (error instanceof GenerationError) return response.status(error.status).json({ error: error.message })
    console.error(error)
    response.status(500).json({ error: 'Widget generation failed' })
  }
})

app.use(express.static(staticDir, { index: false }))
app.get('*path', (_request, response) => response.sendFile(path.join(staticDir, 'index.html')))

const httpServer = app.listen(config.appPort, '0.0.0.0', () => {
  console.log(`theadoc app listening on ${config.appPort}`)
})
const syncServer = await startSyncServer(path.join(config.dataDir, 'automerge'), config.syncPort)
console.log(`theadoc sync listening on ${config.syncPort}`)

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await syncServer.close()
  await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())))
}

process.on('SIGTERM', () => void stop().then(() => process.exit(0)))
process.on('SIGINT', () => void stop().then(() => process.exit(0)))
