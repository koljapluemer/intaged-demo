import 'dotenv/config'
import path from 'node:path'

function integer(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  appPort: integer('APP_PORT', 3000),
  syncPort: integer('SYNC_PORT', 3030),
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-5.6-terra',
  openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
  maxConcurrentGenerations: 2,
  maxQueuedGenerations: 10,
  maxSpecLength: 20_000,
}
