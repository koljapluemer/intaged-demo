import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { GeneratorRoutes, ModelRoute } from './generator.js'

/*
 * The model pipeline, in code on purpose: every change is a commit, identical locally and on the server, and
 * shows up as a new settingsHash in the run log. Record the reason for changes in pipeline_ideas.md.
 * .env only decides whether a provider is available (its API key).
 */

/**
 * Gemini models, tried in order; each run uses the first one not paused after a 429. Free-tier quotas are per
 * model (AI Studio rate-limit page, 2026-11-01: RPM / input TPM / RPD). gemini-3.7-flash is left out: it counts
 * against the gemini-3.8-flash quota.
 */
const GEMINI_CHAIN = [
  'gemini-3.8-flash', // 5 / 250K / 20
  'gemini-3.6-flash', // 5 / 250K / 20
  'gemini-3.5-flash-lite', // 15 / 250K / 500
  'gemini-3.1-flash-lite', // 15 / 250K / 500
]

/** 'minimal' is not supported by gemini-3.8-flash. */
const GEMINI_THINKING_LEVEL = 'low'

/**
 * Paid fallback for every failed attempt, and the only model without a Gemini key. Plain routing (no `:nitro`):
 * the one logged :nitro run cost about 2x the list price ($2 / $12 per million tokens).
 */
const OPENROUTER_MODEL = 'openai/gpt-5.6-terra'

/** GPT-5.6 defaults to medium; OpenRouter's migration guide suggests trying one level lower. */
const OPENROUTER_REASONING_EFFORT = 'low'

export function createRoutes(keys: { google: string; openRouter: string }): GeneratorRoutes | null {
  if (!keys.openRouter) return null
  const openRouter: ModelRoute = {
    model: createOpenRouter({ apiKey: keys.openRouter }).chat(OPENROUTER_MODEL),
    label: `openrouter/${OPENROUTER_MODEL}`,
    providerOptions: { openrouter: { reasoning: { effort: OPENROUTER_REASONING_EFFORT } } },
  }
  if (!keys.google) return { primaries: [openRouter] }

  const google = createGoogleGenerativeAI({ apiKey: keys.google })
  const [first, ...rest] = GEMINI_CHAIN.map(
    (modelId): ModelRoute => ({
      model: google(modelId),
      label: `google/${modelId}`,
      // Free-tier 429/503s fail fast to the next model instead of costing ~6s of SDK backoff.
      maxRetries: 0,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL } } },
    }),
  )
  return { primaries: [first, ...rest], fallback: openRouter }
}
