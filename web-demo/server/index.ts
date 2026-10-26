import { createHash, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import express, { type Request } from 'express'
import { z } from 'zod'
import { ArtifactStore } from './artifacts.js'
import { Bundler } from './bundler.js'
import { config } from './config.js'
import { WorkQueue } from './concurrency.js'
import { DocumentRegistry } from './documents.js'
import { GENERATOR_VERSION, WidgetGenerator, hashSpec } from './generator.js'
import { GenerationJobs } from './jobs.js'
import { PackageRegistry } from './packages.js'
import { startSyncServer } from './sync.js'

const staticDir = path.resolve('dist')
const store = new ArtifactStore(config.widgetsDir)
const bundler = new Bundler()
const generator = new WidgetGenerator(bundler, new PackageRegistry())
const queue = new WorkQueue(config.maxConcurrentGenerations, config.maxQueuedGenerations)
const jobs = new GenerationJobs()
const documents = new DocumentRegistry(path.join(config.dataDir, 'documents.json'))

const documentId = z.string().min(1).max(500)
const registerSchema = z.object({ documentId })
const generateSchema = z.object({
  documentId,
  blockId: z.string().uuid(),
  spec: z.string().trim().min(1).max(config.maxSpecLength),
  previousRevision: z.string().optional(),
  errors: z.array(z.string().max(2_000)).max(10).optional(),
})

const digest = (value: string) => createHash('sha256').update(value).digest()

function isAdmin(request: Request) {
  const token = request.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!config.adminToken || !token) return false
  // Comparing digests keeps the comparison constant-time regardless of token length.
  return timingSafeEqual(digest(token), digest(config.adminToken))
}

await Promise.all([store.initialize(), bundler.initialize(), documents.initialize()])
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

app.get('/api/bundles/:hash', async (request, response, next) => {
  try {
    const bundle = await bundler.getBundle(request.params.hash)
    if (!bundle) return response.status(404).json({ error: 'Bundle not found' })
    response.set('Cache-Control', 'public, max-age=31536000, immutable').type('json').send(bundle)
  } catch (error) {
    next(error)
  }
})

app.post('/api/documents', async (request, response, next) => {
  if (!isAdmin(request)) return response.status(401).json({ error: 'Admin token required' })
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid document' })
  try {
    await documents.register(parsed.data.documentId)
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.post('/api/widgets/generate', async (request, response) => {
  const parsed = generateSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid generation request' })
  if (!documents.has(parsed.data.documentId)) {
    return response.status(403).json({ error: 'Widget generation is not enabled for this document.' })
  }
  if (queue.full) {
    return response.status(429).json({ error: 'Too many widgets are being generated right now. Try again in a minute.' })
  }
  const input = parsed.data

  const job = jobs.start(input.blockId, async (setStage) => {
    const previous = input.previousRevision ? await store.get(input.previousRevision) : null
    const result = await queue.run(() =>
      generator.generate({
        spec: input.spec,
        errors: input.errors,
        previous: previous ? { files: previous.files, deps: previous.deps, network: previous.network } : undefined,
        onProgress: setStage,
      }),
    )
    return store.save(
      {
        documentId: input.documentId,
        blockId: input.blockId,
        spec: input.spec,
        specHash: hashSpec(input.spec),
        model: config.model,
        generatorVersion: GENERATOR_VERSION,
      },
      result.source,
      result.bundle,
    )
  })
  response.status(202).json(job)
})

app.get('/api/generations/:id', (request, response) => {
  const job = jobs.get(request.params.id)
  if (!job) return response.status(404).json({ error: 'Unknown generation' })
  response.set('Cache-Control', 'no-store').json(job)
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
