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
  openRouterModel: process.env.OPENROUTER_MODEL ?? 'openai/gpt-5.6-terra',
  openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
  googleModel: process.env.GOOGLE_GENERATIVE_AI_MODEL ?? 'gemini-3.7-flash',
  googleKey,
  googleThinkingLevel: (process.env.GOOGLE_GENERATIVE_AI_THINKING_LEVEL ?? 'low') as
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  maxConcurrentGenerations: integer('MAX_CONCURRENT_GENERATIONS', googleKey ? 1 : 2),
  maxQueuedGenerations: 10,
  maxSpecLength: 20_000,
  maxAgentSteps: integer('MAX_AGENT_STEPS', 24),
  maxAgentTokens: integer('MAX_AGENT_TOKENS', 400_000),
  reasoningEffort: (process.env.OPENROUTER_REASONING_EFFORT ?? 'low') as 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
  generationTimeoutMs: 300_000,
  installTimeoutMs: 120_000,
  maxBundleBytes: 3_000_000,
  maxPackageUnpackedBytes: 50_000_000,
  minWeeklyDownloads: integer('MIN_WEEKLY_DOWNLOADS', 500),
}
