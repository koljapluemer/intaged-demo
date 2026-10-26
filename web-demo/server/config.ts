import 'dotenv/config'
import path from 'node:path'

function integer(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const dataDir = path.resolve(process.env.DATA_DIR ?? './data')

export const config = {
  appPort: integer('APP_PORT', 3000),
  syncPort: integer('SYNC_PORT', 3030),
  dataDir,
  widgetsDir: path.join(dataDir, 'widgets'),
  bundlesDir: path.join(dataDir, 'bundles'),
  packagesDir: path.join(dataDir, 'packages'),
  npmCacheDir: path.join(dataDir, 'npm-cache'),
  model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-5.6-terra',
  openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
  maxConcurrentGenerations: 2,
  maxQueuedGenerations: 10,
  maxSpecLength: 20_000,
  maxAgentSteps: integer('MAX_AGENT_STEPS', 24),
  maxAgentTokens: integer('MAX_AGENT_TOKENS', 400_000),
  generationTimeoutMs: 300_000,
  installTimeoutMs: 120_000,
  maxBundleBytes: 3_000_000,
  maxPackageUnpackedBytes: 50_000_000,
  minWeeklyDownloads: integer('MIN_WEEKLY_DOWNLOADS', 500),
}
