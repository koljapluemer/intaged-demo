import { createHash, randomUUID } from 'node:crypto'
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
  signal?: AbortSignal
  onProgress?: (stage: string) => void
}

export interface GenerateResult {
  source: WidgetSource
  bundle: string
  model: string
}

export interface ModelRoute {
  model: LanguageModel
  label: string
  providerOptions?: ProviderOptions
}

export interface GeneratorRoutes {
  primary: ModelRoute
  fallback?: ModelRoute
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
    // One OpenRouter session per generation keeps every OpenRouter step on the same provider for prompt-cache hits.
    const sessionId = randomUUID()
    try {
      return await this.attempt(input, sessionId, this.routes.primary)
    } catch (error) {
      if (input.signal?.aborted) throw error
      if (!(error instanceof GenerationError) || !error.retry) throw error
      console.warn(`widget generation attempt failed, retrying: ${error.message}`)
      input.onProgress?.('Fixing problems')
      const retryRoute = this.routes.fallback ?? this.routes.primary
      if (error.status === 429 && retryRoute === this.routes.primary) {
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
      )
      return retryRoute === this.routes.primary
        ? result
        : { ...result, model: `${this.routes.primary.label} -> ${retryRoute.label}` }
    }
  }

  private async attempt(input: GenerateInput, sessionId: string, route: ModelRoute): Promise<GenerateResult> {
    const workspace = new Workspace(input.previous)
    let stage = ''
    const progress = (next: string) => {
      if (next === stage) return
      stage = next
      input.onProgress?.(next)
    }

    // One JSON line per step and per run, to see where time and tokens go (`just logs`).
    const runStart = Date.now()
    let stepStart = runStart
    const totals = { steps: 0, input: 0, cached: 0, output: 0, reasoning: 0 }
    const logStep = (step: StepResult<WidgetTools>) => {
      const { usage } = step
      const tokens = {
        input: usage.inputTokens ?? 0,
        cached: usage.inputTokenDetails.cacheReadTokens ?? 0,
        output: usage.outputTokens ?? 0,
        reasoning: usage.outputTokenDetails.reasoningTokens ?? 0,
      }
      totals.steps += 1
      totals.input += tokens.input
      totals.cached += tokens.cached
      totals.output += tokens.output
      totals.reasoning += tokens.reasoning
      console.log(
        JSON.stringify({
          event: 'generation_step',
          model: route.label,
          step: step.stepNumber,
          tools: step.toolCalls.map((call) => call.toolName),
          ms: Date.now() - stepStart,
          ...tokens,
        }),
      )
    }

    const finished: StopCondition<WidgetTools> = () => workspace.finished
    const overBudget: StopCondition<WidgetTools> = ({ steps }) =>
      steps.reduce((total, step) => total + (step.usage.totalTokens ?? 0), 0) > config.maxAgentTokens

    const agent = new ToolLoopAgent({
      model: route.model,
      instructions: systemPrompt(this.bundler.preinstalled),
      tools: createTools({ workspace, registry: this.registry, bundler: this.bundler }),
      maxOutputTokens: 16_000,
      providerOptions:
        route.providerOptions ??
        ({ openrouter: { reasoning: { effort: config.reasoningEffort }, session_id: sessionId } } satisfies ProviderOptions),
      stopWhen: [isStepCount(config.maxAgentSteps), finished, overBudget],
      onToolExecutionStart: ({ toolCall }) => progress(stageFor(toolCall.toolName)),
      onStepStart: () => {
        stepStart = Date.now()
      },
      onStepEnd: logStep,
    })

    const logRun = (outcome: string) =>
      console.log(
        JSON.stringify({ event: 'generation_run', model: route.label, outcome, ms: Date.now() - runStart, ...totals }),
      )

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
    }
    const timedOut = failure !== null && isTimeout(failure) && !input.signal?.aborted
    if (failure !== null && !timedOut) {
      logRun('error')
      const error = friendlyError(failure)
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
    logRun(bundle ? (timedOut ? 'timeout_salvaged' : 'ok') : timedOut ? 'timeout' : 'no_build')
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
