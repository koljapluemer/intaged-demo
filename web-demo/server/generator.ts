import { createHash } from 'node:crypto'
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
import { GENERATOR_VERSION, SYSTEM_PROMPT } from './prompt.js'
import { createTools, stageFor, type WidgetTools } from './tools.js'
import { Workspace } from './workspace.js'

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
  if (input.previous) {
    parts.push(
      'The workspace contains the previous version of this widget. Make it match the specification above; remove elements the specification does not call for.',
    )
  }
  if (input.errors?.length) {
    parts.push(`PROBLEMS TO FIX (from the rendered widget or a previous attempt):\n${input.errors.map((error) => `- ${error}`).join('\n')}`)
  }
  return parts.join('\n\n')
}

function friendlyError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error
  const cause = RetryError.isInstance(error) ? error.lastError : error
  if (APICallError.isInstance(cause) && cause.statusCode === 402) {
    return new GenerationError('Demo generation budget exhausted', 402)
  }
  if (APICallError.isInstance(cause) && cause.statusCode === 429) {
    return new GenerationError('The model is busy. Try again shortly.', 429, { problems: [] })
  }
  if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
    return new GenerationError('Generation took too long. Try a simpler description.', 504)
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  return new GenerationError(`The model request failed: ${message}`, 502, { problems: [] })
}

export class WidgetGenerator {
  private readonly model: LanguageModel | null

  constructor(
    private readonly bundler: Bundler,
    private readonly registry: PackageRegistry,
    model?: LanguageModel,
  ) {
    this.model =
      model ?? (config.openRouterKey ? createOpenRouter({ apiKey: config.openRouterKey }).chat(config.model) : null)
  }

  /** Runs the agent, and once more from where it left off if the first attempt fails in a recoverable way. */
  async generate(input: GenerateInput): Promise<GenerateResult> {
    try {
      return await this.attempt(input)
    } catch (error) {
      if (!(error instanceof GenerationError) || !error.retry) throw error
      console.warn(`widget generation attempt failed, retrying: ${error.message}`)
      input.onProgress?.('Fixing problems')
      if (error.status === 429) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      return this.attempt({
        ...input,
        previous: error.retry.source ?? input.previous,
        errors: error.retry.problems.length ? error.retry.problems : input.errors,
      })
    }
  }

  private async attempt(input: GenerateInput): Promise<GenerateResult> {
    if (!this.model) throw new GenerationError('OPENROUTER_API_KEY is not configured', 503)
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
      model: this.model,
      instructions: SYSTEM_PROMPT,
      tools: createTools({ workspace, registry: this.registry, bundler: this.bundler }),
      // File edits and builds within one step must apply in the order the model wrote them.
      toolCallConcurrency: 1,
      maxOutputTokens: 16_000,
      stopWhen: [isStepCount(config.maxAgentSteps), finished, overBudget],
      onToolExecutionStart: ({ toolCall }) => progress(stageFor(toolCall.toolName)),
      onStepStart: () => {
        stepStart = Date.now()
      },
      onStepEnd: logStep,
    })

    progress('Planning')
    let outcome = 'ok'
    try {
      await agent.generate({
        prompt: userPrompt(input),
        abortSignal: input.signal,
        timeout: config.generationTimeoutMs,
      })
    } catch (error) {
      outcome = 'error'
      throw friendlyError(error)
    } finally {
      console.log(
        JSON.stringify({
          event: 'generation_run',
          model: config.model,
          outcome: outcome === 'ok' && !workspace.currentBundle ? 'no_build' : outcome,
          ms: Date.now() - runStart,
          ...totals,
        }),
      )
    }

    // An unfinished run still counts if its latest change built cleanly.
    const bundle = workspace.currentBundle
    if (!bundle) {
      const diagnostics = workspace.lastDiagnostics
      const problems = diagnostics.length ? diagnostics : ['The previous attempt stopped before producing a successful build.']
      throw new GenerationError(
        `The widget could not be built${diagnostics.length ? `: ${diagnostics.slice(0, 3).join('; ')}` : ''}`,
        502,
        { source: workspace.source, problems },
      )
    }
    return { source: workspace.source, bundle }
  }
}

export { GENERATOR_VERSION }
