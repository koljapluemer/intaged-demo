import path from 'node:path'

function integer(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const dataDir = path.resolve(process.env.DATA_DIR ?? './data')
const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ''

export const config = {
  appPort: integer('APP_PORT', 3000),
  syncPort: integer('SYNC_PORT', 3030),
  dataDir,
  widgetsDir: path.join(dataDir, 'widgets'),
  bundlesDir: path.join(dataDir, 'bundles'),
  packagesDir: path.join(dataDir, 'packages'),
  npmCacheDir: path.join(dataDir, 'npm-cache'),
  widgetBaseDir: path.resolve(process.env.WIDGET_BASE_DIR ?? './widget-base'),
  openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
  googleKey,
  adminToken: process.env.ADMIN_TOKEN ?? '',
  maxConcurrentGenerations: integer('MAX_CONCURRENT_GENERATIONS', googleKey ? 1 : 2),
  maxQueuedGenerations: 10,
  maxSpecLength: 20_000,
  maxAgentSteps: 24,
  maxAgentTokens: 400_000,
  generationTimeoutMs: 300_000,
  /** Directory for the JSONL run log (one file per UTC day); empty logs to the console only. */
  runLogDir: process.env.RUN_LOG_DIR ?? '',
  installTimeoutMs: 120_000,
  maxBundleBytes: 3_000_000,
  maxPackageUnpackedBytes: 50_000_000,
  minWeeklyDownloads: integer('MIN_WEEKLY_DOWNLOADS', 500),
}
