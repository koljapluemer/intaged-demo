import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import {
  APICallError,
  isStepCount,
  RetryError,
  ToolLoopAgent,
  type LanguageModel,
  type StepResult,
  type StopCondition,
  wrapLanguageModel,
} from 'ai'
import type { WidgetSource } from '../src/types.js'
import type { Bundler } from './bundler.js'
import { config } from './config.js'
import type { PackageRegistry } from './packages.js'
import { GENERATOR_VERSION, systemPrompt } from './prompt.js'
import { createTools, stageFor, type WidgetTools } from './tools.js'
import { Workspace } from './workspace.js'

type ProviderOptions = NonNullable<LanguageModelV4CallOptions['providerOptions']>

export interface GenerateInput {
  spec: string
  previous?: WidgetSource
  errors?: string[]
  /** The run that produced `previous`, for linking follow-up generations in the run log. */
  previousRunId?: string
  previousSpecHash?: string
  signal?: AbortSignal
  onProgress?: (stage: string) => void
}

export interface GenerateResult {
  source: WidgetSource
  bundle: string
  model: string
  runId: string
}

type AttemptResult = Omit<GenerateResult, 'runId'>

export interface ModelRoute {
  model: Exclude<LanguageModel, string>
  label: string
  providerOptions?: ProviderOptions
  /** SDK retries per request (default 2, with 2s/4s backoff). 0 hands failures to the fallback immediately. */
  maxRetries?: number
}

export interface GeneratorRoutes {
  primary: ModelRoute
  fallback?: ModelRoute
}

interface RunTotals {
  attempts: number
  modelCalls: number
  steps: number
  input: number
  cached: number
  output: number
  reasoning: number
  costUsd: number
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const shortHash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, 12)

/** OpenRouter reports the billed cost of each call; other providers report nothing. */
function stepCost(step: StepResult<WidgetTools>): number | undefined {
  const usage = (step.providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage
  return typeof usage?.cost === 'number' ? usage.cost : undefined
}

let preparedRunLogDir = ''

/** Appends one line to <runLogDir>/<UTC date>.jsonl. Losing a line is acceptable; failing a generation is not. */
function persistRunLogLine(line: string) {
  const directory = config.runLogDir
  if (!directory) return
  try {
    if (preparedRunLogDir !== directory) {
      mkdirSync(directory, { recursive: true })
      preparedRunLogDir = directory
    }
    appendFileSync(path.join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${line}\n`)
  } catch (error) {
    console.warn(`Could not write run log: ${errorMessage(error)}`)
  }
}

/** Trace for a complete generation, including any retry/fallback: one JSON line per event, to the console and the run log directory. */
class GenerationRunLog {
  readonly id = randomUUID()
  private readonly started = Date.now()
  private readonly totals: RunTotals = { attempts: 0, modelCalls: 0, steps: 0, input: 0, cached: 0, output: 0, reasoning: 0, costUsd: 0 }

  constructor(input: GenerateInput, settings: object) {
    const specHash = hashSpec(input.spec)
    this.write('generation_start', {
      specChars: input.spec.length,
      specHash,
      continuation: Boolean(input.previous),
      previousRunId: input.previousRunId ?? null,
      specChanged: input.previousSpecHash ? input.previousSpecHash !== specHash : null,
      reportedErrors: input.errors?.length ?? 0,
      ...settings,
    })
  }

  attempt(model: string) {
    this.totals.attempts++
    this.write('generation_attempt_start', { attempt: this.totals.attempts, model })
    return this.totals.attempts
  }

  step(attempt: number, model: string, step: StepResult<WidgetTools>) {
    const { usage, performance } = step
    const tokens = {
      input: usage.inputTokens ?? 0,
      cached: usage.inputTokenDetails.cacheReadTokens ?? 0,
      output: usage.outputTokens ?? 0,
      reasoning: usage.outputTokenDetails.reasoningTokens ?? 0,
    }
    const costUsd = stepCost(step)
    this.totals.steps++
    this.totals.costUsd += costUsd ?? 0
    this.totals.input += tokens.input
    this.totals.cached += tokens.cached
    this.totals.output += tokens.output
    this.totals.reasoning += tokens.reasoning
    const resultByCall = new Map(step.toolResults.map((result) => [result.toolCallId, result.output]))
    this.write('generation_step', {
      attempt,
      model,
      step: step.stepNumber,
      ms: Math.round(performance.stepTimeMs),
      modelMs: Math.round(performance.responseTimeMs),
      finishReason: step.finishReason,
      tools: step.toolCalls.map((call) => ({
        name: call.toolName,
        ms: Math.round(performance.toolExecutionMs[call.toolCallId] ?? 0),
        ...toolOutcome(resultByCall.get(call.toolCallId)),
      })),
      ...tokens,
      ...(costUsd === undefined ? {} : { costUsd }),
    })
  }

  /** One raw provider request. The SDK retries failed requests silently inside a step; each retry is its own model_call. */
  modelCall(attempt: number, model: string, started: number, error?: unknown) {
    this.totals.modelCalls++
    this.write('model_call', {
      attempt,
      model,
      ms: Date.now() - started,
      ok: error === undefined,
      ...(error === undefined
        ? {}
        : {
            ...(APICallError.isInstance(error) ? { status: error.statusCode ?? null, retryable: error.isRetryable } : {}),
            error: errorMessage(error).slice(0, 500),
          }),
    })
  }

  /** `planningMs` is the time until the first tool started, which the UI shows as "Planning". */
  attemptEnd(attempt: number, model: string, started: number, outcome: string, planningMs: number | null, error?: unknown) {
    this.write('generation_attempt_end', {
      attempt,
      model,
      outcome,
      ms: Date.now() - started,
      planningMs,
      ...(error === undefined ? {} : { error: errorMessage(error) }),
    })
  }

  routePaused(model: string, pauseMs: number, until: number) {
    this.write('route_paused', { model, pauseMs, until: new Date(until).toISOString() })
  }

  routeSkipped(model: string, until: number) {
    this.write('route_skipped', { model, until: new Date(until).toISOString() })
  }

  retry(error: GenerationError, from: string, to: string) {
    this.write('generation_retry', {
      reason: error.message,
      status: error.status,
      from,
      to,
      problems: error.retry?.problems.slice(0, 5) ?? [],
    })
  }

  end(outcome: 'ok' | 'error', details: object) {
    const { costUsd, ...totals } = this.totals
    this.write('generation_end', {
      outcome,
      ms: Date.now() - this.started,
      reloops: totals.attempts - 1,
      ...totals,
      costUsd: Math.round(costUsd * 1e6) / 1e6,
      ...details,
    })
  }

  private write(event: string, details: object) {
    const line = JSON.stringify({ event, ts: new Date().toISOString(), runId: this.id, ...details })
    console.log(line)
    persistRunLogLine(line)
  }
}

function toolOutcome(output: unknown): object {
  if (typeof output === 'string') {
    return output.startsWith('Error:')
      ? { outcome: 'error', error: output.slice(0, 500) }
      : { outcome: 'ok', result: { chars: output.length } }
  }
  if (Array.isArray(output)) return { outcome: 'ok', result: { items: output.length } }
  if (output && typeof output === 'object') {
    const result = output as Record<string, unknown>
    if (result.ok === false) {
      return { outcome: 'error', error: Array.isArray(result.diagnostics) ? result.diagnostics.slice(0, 5) : 'Tool failed' }
    }
    const summary = Object.fromEntries(
      ['ok', 'bytes', 'added', 'removed', 'network', 'delivered'].flatMap((key) => (key in result ? [[key, result[key]]] : [])),
    )
    return { outcome: 'ok', ...(Object.keys(summary).length ? { result: summary } : {}) }
  }
  return { outcome: output === undefined ? 'missing' : 'ok' }
}

export function hashSpec(spec: string) {
  return createHash('sha256').update(spec.trim()).digest('hex')
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    /** Set when another attempt could succeed: the source to continue from and the problems to fix. */
    readonly retry?: { source?: WidgetSource; problems: string[] },
  ) {
    super(message)
  }
}

const RETRY_DELAY_MS = 5_000
const MAX_OUTPUT_TOKENS = 16_000

function userPrompt(input: GenerateInput) {
  const parts = [`SPECIFICATION:\n${input.spec}`]
  if (!input.previous) {
    parts.push(
      'The workspace holds only placeholder files (body.html, style.css and a TODO main.ts) and no dependencies. Do not list or read them: write the complete widget with write_files.',
    )
  } else {
    parts.push(
      'The workspace contains the previous version of this widget. Make it match the specification above; remove elements the specification does not call for.',
    )
  }
  if (input.errors?.length) {
    parts.push(`PROBLEMS TO FIX (from the rendered widget or a previous attempt):\n${input.errors.map((error) => `- ${error}`).join('\n')}`)
  }
  return parts.join('\n\n')
}

const rootCause = (error: unknown) => (RetryError.isInstance(error) ? error.lastError : error)

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/**
 * How long to stop sending requests to a model after it rate-limited us, or null if the error is no rate limit.
 * Gemini's 429 body names the exhausted quota and a RetryInfo.retryDelay. A daily quota (the free tier allows
 * 20 requests per day) pauses for an hour, after which one cheap request finds out whether it has reset.
 */
export function rateLimitPauseMs(error: unknown): number | null {
  const cause = rootCause(error)
  if (!APICallError.isInstance(cause) || cause.statusCode !== 429) return null
  const details = `${cause.message}\n${cause.responseBody ?? ''}`
  if (/PerDay|per day/i.test(details)) return HOUR_MS
  const retryDelay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(details)
  return Math.min(retryDelay ? Math.ceil(Number(retryDelay[1]) * 1000) : MINUTE_MS, HOUR_MS)
}

function isTimeout(error: unknown) {
  const cause = rootCause(error)
  return cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')
}

function friendlyError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error
  const cause = rootCause(error)
  if (APICallError.isInstance(cause) && cause.statusCode === 402) {
    return new GenerationError('Demo generation budget exhausted', 402)
  }
  if (APICallError.isInstance(cause) && cause.statusCode === 429) {
    return new GenerationError('The model is busy. Try again shortly.', 429, { problems: [] })
  }
  if (isTimeout(cause)) {
    return new GenerationError('Generation timed out before the widget built. Please try again.', 504, { problems: [] })
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  return new GenerationError(`The model request failed: ${message}`, 502, { problems: [] })
}

export class WidgetGenerator {
  private readonly routes: GeneratorRoutes | null
  /** Primary models that rate-limited us, by label, until the time they are worth trying again. */
  private readonly pausedUntil = new Map<string, number>()

  constructor(
    private readonly bundler: Bundler,
    private readonly registry: PackageRegistry,
    routes?: GeneratorRoutes,
  ) {
    if (routes) {
      this.routes = routes
      return
    }

    const openRouter = config.openRouterKey
      ? {
          model: createOpenRouter({ apiKey: config.openRouterKey }).chat(config.openRouterModel),
          label: `openrouter/${config.openRouterModel}`,
        }
      : undefined
    const google = config.googleKey
      ? {
          model: createGoogleGenerativeAI({ apiKey: config.googleKey })(config.googleModel),
          label: `google/${config.googleModel}`,
          // Free-tier 429/503s fail fast to OpenRouter instead of costing ~6s of SDK backoff.
          maxRetries: 0,
          providerOptions: {
            google: { thinkingConfig: { thinkingLevel: config.googleThinkingLevel } },
          },
        }
      : undefined
    this.routes = google && openRouter ? { primary: google, fallback: openRouter } : openRouter ? { primary: openRouter } : null
  }

  /** Runs the agent, and once more from where it left off if the first attempt fails in a recoverable way. */
  async generate(input: GenerateInput): Promise<GenerateResult> {
    if (!this.routes) throw new GenerationError('OPENROUTER_API_KEY is not configured', 503)
    const log = new GenerationRunLog(input, this.settings(this.routes))
    // One OpenRouter session per generation keeps every OpenRouter step on the same provider for prompt-cache hits.
    const sessionId = randomUUID()
    try {
      const result = await this.generateWithRetry(input, sessionId, log)
      log.end('ok', { model: result.model, bundle: result.bundle })
      return { ...result, runId: log.id }
    } catch (error) {
      log.end('error', { error: errorMessage(error) })
      throw error
    }
  }

  /** Everything that shapes a run's behaviour, so runs can be grouped by pipeline configuration (`settingsHash`). */
  private settings(routes: GeneratorRoutes) {
    const settings = {
      generatorVersion: GENERATOR_VERSION,
      primary: routes.primary.label,
      fallback: routes.fallback?.label ?? null,
      primaryMaxRetries: routes.primary.maxRetries ?? 2,
      fallbackMaxRetries: routes.fallback ? (routes.fallback.maxRetries ?? 2) : null,
      reasoningEffort: config.reasoningEffort,
      googleThinkingLevel: config.googleThinkingLevel,
      maxAgentSteps: config.maxAgentSteps,
      maxAgentTokens: config.maxAgentTokens,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      generationTimeoutMs: config.generationTimeoutMs,
      promptHash: shortHash(systemPrompt(this.bundler.preinstalled)),
    }
    return { ...settings, settingsHash: shortHash(settings) }
  }

  private async generateWithRetry(input: GenerateInput, sessionId: string, log: GenerationRunLog) {
    const { primary, fallback } = this.routes!
    const pausedUntil = this.pausedUntil.get(primary.label) ?? 0
    if (fallback && pausedUntil > Date.now()) {
      log.routeSkipped(primary.label, pausedUntil)
      return this.attempt(input, sessionId, fallback, log)
    }
    try {
      return await this.attempt(input, sessionId, this.routes!.primary, log)
    } catch (error) {
      if (input.signal?.aborted) throw error
      if (!(error instanceof GenerationError) || !error.retry) throw error
      input.onProgress?.('Fixing problems')
      const retryRoute = this.routes!.fallback ?? this.routes!.primary
      log.retry(error, this.routes!.primary.label, retryRoute.label)
      if (error.status === 429 && retryRoute === this.routes!.primary) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
      const result = await this.attempt(
        {
          ...input,
          previous: error.retry.source ?? input.previous,
          errors: error.retry.problems.length ? error.retry.problems : input.errors,
        },
        sessionId,
        retryRoute,
        log,
      )
      return retryRoute === this.routes!.primary
        ? result
        : { ...result, model: `${this.routes!.primary.label} -> ${retryRoute.label}` }
    }
  }

  private pauseIfRateLimited(route: ModelRoute, error: unknown, log: GenerationRunLog) {
    if (route !== this.routes?.primary || !this.routes.fallback) return
    const pauseMs = rateLimitPauseMs(error)
    if (pauseMs === null) return
    const until = Date.now() + pauseMs
    this.pausedUntil.set(route.label, until)
    log.routePaused(route.label, pauseMs, until)
  }

  private async attempt(input: GenerateInput, sessionId: string, route: ModelRoute, log: GenerationRunLog): Promise<AttemptResult> {
    const workspace = new Workspace(input.previous)
    let stage = ''
    const progress = (next: string) => {
      if (next === stage) return
      stage = next
      input.onProgress?.(next)
    }

    // One compact JSON line per event makes local logs greppable without a telemetry service.
    const runStart = Date.now()
    const attempt = log.attempt(route.label)
    let firstToolAt: number | null = null
    const planningMs = () => (firstToolAt === null ? null : firstToolAt - runStart)

    const model = wrapLanguageModel({
      model: route.model,
      middleware: {
        wrapGenerate: async ({ doGenerate }) => {
          const started = Date.now()
          try {
            const result = await doGenerate()
            log.modelCall(attempt, route.label, started)
            return result
          } catch (error) {
            log.modelCall(attempt, route.label, started, error)
            throw error
          }
        },
      },
    })

    const finished: StopCondition<WidgetTools> = () => workspace.finished
    const overBudget: StopCondition<WidgetTools> = ({ steps }) =>
      steps.reduce((total, step) => total + (step.usage.totalTokens ?? 0), 0) > config.maxAgentTokens

    const agent = new ToolLoopAgent({
      model,
      instructions: systemPrompt(this.bundler.preinstalled),
      tools: createTools({ workspace, registry: this.registry, bundler: this.bundler }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: route.maxRetries,
      providerOptions:
        route.providerOptions ??
        ({ openrouter: { reasoning: { effort: config.reasoningEffort }, session_id: sessionId } } satisfies ProviderOptions),
      stopWhen: [isStepCount(config.maxAgentSteps), finished, overBudget],
      onToolExecutionStart: ({ toolCall }) => {
        firstToolAt ??= Date.now()
        progress(stageFor(toolCall.toolName))
      },
      onStepEnd: (step) => log.step(attempt, route.label, step),
    })

    progress('Planning')
    let failure: unknown = null
    try {
      await agent.generate({
        prompt: userPrompt(input),
        abortSignal: input.signal,
        timeout: config.generationTimeoutMs,
      })
    } catch (error) {
      failure = error
      this.pauseIfRateLimited(route, error, log)
    }
    const timedOut = failure !== null && isTimeout(failure) && !input.signal?.aborted
    if (failure !== null && !timedOut) {
      const error = friendlyError(failure)
      log.attemptEnd(attempt, route.label, runStart, 'error', planningMs(), error)
      if (input.signal?.aborted || !error.retry) throw error
      throw new GenerationError(error.message, error.status, {
        source: workspace.source,
        problems: workspace.lastDiagnostics.length ? workspace.lastDiagnostics : error.retry.problems,
      })
    }

    // An unfinished run (text reply, step limit, timeout) still counts if its latest change builds cleanly.
    if (!workspace.built && (workspace.changed || input.previous)) {
      workspace.recordBuild(await this.bundler.build(workspace.source))
    }
    const bundle = workspace.currentBundle
    log.attemptEnd(
      attempt,
      route.label,
      runStart,
      bundle ? (timedOut ? 'timeout_salvaged' : 'ok') : timedOut ? 'timeout' : 'no_build',
      planningMs(),
    )
    if (!bundle && timedOut) {
      const error = friendlyError(failure)
      throw new GenerationError(error.message, error.status, {
        source: workspace.source,
        problems: workspace.lastDiagnostics,
      })
    }
    if (!bundle) {
      const diagnostics = workspace.lastDiagnostics
      const problems = diagnostics.length ? diagnostics : ['The previous attempt stopped before producing a successful build.']
      throw new GenerationError(
        `The widget could not be built${diagnostics.length ? `: ${diagnostics.slice(0, 3).join('; ')}` : ''}`,
        502,
        { source: workspace.source, problems },
      )
    }
    return { source: workspace.source, bundle, model: route.label }
  }
}

export { GENERATOR_VERSION }
