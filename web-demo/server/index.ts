import { createHash, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { isValidDocumentId, type DocHandle, type DocumentId } from '@automerge/automerge-repo'
import express, { type Request, type Response } from 'express'
import { z } from 'zod'
import { ArtifactStore } from './artifacts.js'
import { Bundler } from './bundler.js'
import { config } from './config.js'
import { WorkQueue } from './concurrency.js'
import { DocumentRegistry } from './documents.js'
import { GENERATOR_VERSION, WidgetGenerator, hashSpec } from './generator.js'
import { GenerationJobs } from './jobs.js'
import { PackageRegistry } from './packages.js'
import { redactSpecs, SHARE_ACCESS, ShareRegistry, type ShareAccess } from './shares.js'
import { startSyncServer } from './sync.js'
import type { TheadocDocument } from '../src/types.js'

const staticDir = path.resolve('dist')
const store = new ArtifactStore(config.widgetsDir)
const bundler = new Bundler()
const generator = new WidgetGenerator(bundler, new PackageRegistry())
const queue = new WorkQueue(config.maxConcurrentGenerations, config.maxQueuedGenerations)
const jobs = new GenerationJobs()
const documents = new DocumentRegistry(path.join(config.dataDir, 'documents.json'))
const shares = new ShareRegistry(path.join(config.dataDir, 'shares.json'))

const documentId = z.string().min(1).max(500)
const registerSchema = z.object({ documentId })
const shareSchema = z.object({ documentId, access: z.enum(SHARE_ACCESS) })
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

await Promise.all([store.initialize(), bundler.initialize(), documents.initialize(), shares.initialize()])
const syncServer = await startSyncServer(path.join(config.dataDir, 'automerge'), config.syncPort)
console.log(`theadoc sync listening on ${config.syncPort}`)

/** Loads a document from the sync server's storage, or null when it does not exist there. */
async function findDocument(id: string): Promise<DocHandle<TheadocDocument> | null> {
  if (!isValidDocumentId(id)) return null
  try {
    return await syncServer.repo.find<TheadocDocument>(id as DocumentId, { signal: AbortSignal.timeout(5_000) })
  } catch {
    return null
  }
}

/** What a read-only viewer receives: never the document ID, and no specs for the reader level. */
function sharedPayload(handle: DocHandle<TheadocDocument>, access: ShareAccess) {
  const document = handle.doc()
  const markdown = access === 'reader' ? redactSpecs(document.markdown) : document.markdown
  return { access, document: { schemaVersion: 1, markdown, widgets: document.widgets } }
}

async function resolveShare(token: string, response: Response) {
  const share = shares.get(token)
  const handle = share && (await findDocument(share.documentId))
  if (!share || !handle) {
    response.status(404).json({ error: 'Shared document not found' })
    return null
  }
  return { handle, access: share.access }
}
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
    // The document ID grants edit access, so it must not reach read-only viewers through artifacts.
    response.set('Cache-Control', 'public, max-age=31536000, immutable').json({ ...artifact, documentId: undefined })
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

app.post('/api/shares', async (request, response, next) => {
  const parsed = shareSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Invalid share request' })
  try {
    // Knowing the document ID is edit access, which is enough to hand out read-only links.
    if (!(await findDocument(parsed.data.documentId))) return response.status(404).json({ error: 'Document not found' })
    response.status(201).json({ token: await shares.create(parsed.data.documentId, parsed.data.access) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/shared/:token', async (request, response, next) => {
  try {
    const shared = await resolveShare(request.params.token, response)
    if (shared) response.set('Cache-Control', 'no-store').json(sharedPayload(shared.handle, shared.access))
  } catch (error) {
    next(error)
  }
})

app.get('/api/shared/:token/events', async (request, response, next) => {
  try {
    const shared = await resolveShare(request.params.token, response)
    if (!shared) return
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = () => response.write(`data: ${JSON.stringify(sharedPayload(shared.handle, shared.access))}\n\n`)
    let pending: NodeJS.Timeout | null = null
    // Typing produces many small changes; one update per burst is plenty for viewers.
    const onChange = () => {
      pending ??= setTimeout(() => {
        pending = null
        send()
      }, 300)
    }
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 25_000)
    shared.handle.on('change', onChange)
    request.on('close', () => {
      shared.handle.off('change', onChange)
      clearInterval(keepAlive)
      if (pending) clearTimeout(pending)
    })
    send()
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
        previousRunId: previous?.runId,
        previousSpecHash: previous?.specHash,
        onProgress: setStage,
      }),
    )
    return store.save(
      {
        documentId: input.documentId,
        blockId: input.blockId,
        spec: input.spec,
        specHash: hashSpec(input.spec),
        model: result.model,
        generatorVersion: GENERATOR_VERSION,
        runId: result.runId,
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

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await syncServer.close()
  await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())))
}

process.on('SIGTERM', () => void stop().then(() => process.exit(0)))
process.on('SIGINT', () => void stop().then(() => process.exit(0)))
