import { createHash } from 'node:crypto'
import OpenAI from 'openai'
import { z } from 'zod'
import { LIB_NAMES, type WidgetCode } from '../src/types.js'
import { config } from './config.js'
import { GENERATOR_VERSION, SYSTEM_PROMPT } from './prompt.js'

const widgetSchema = z.object({
  html: z.string().max(100_000),
  css: z.string().max(100_000),
  js: z.string().max(150_000),
  libs: z.array(z.enum(LIB_NAMES)).max(LIB_NAMES.length),
})

export interface GenerateInput {
  documentId: string
  blockId: string
  spec: string
  previous?: WidgetCode
  errors?: string[]
}

export function hashSpec(spec: string) {
  return createHash('sha256').update(spec.trim()).digest('hex')
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message)
  }
}

export class WidgetGenerator {
  private readonly client = new OpenAI({
    apiKey: config.openRouterKey || 'missing',
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: 180_000,
  })

  async generate(input: GenerateInput): Promise<WidgetCode> {
    if (!config.openRouterKey) throw new GenerationError('OPENROUTER_API_KEY is not configured', 503)
    const parts = [`SPEC:\n${input.spec}`]
    if (input.previous) parts.push(`PREVIOUS CODE:\n${JSON.stringify(input.previous, null, 2)}`)
    if (input.errors?.length) parts.push(`RUNTIME ERRORS:\n${input.errors.map((error) => `- ${error}`).join('\n')}`)

    try {
      const completion = await this.client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: parts.join('\n\n') },
        ],
        max_completion_tokens: 12_000,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'widget',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['html', 'css', 'js', 'libs'],
              properties: {
                html: { type: 'string' },
                css: { type: 'string' },
                js: { type: 'string' },
                libs: { type: 'array', items: { type: 'string', enum: [...LIB_NAMES] } },
              },
            },
          },
        },
      })
      const content = completion.choices[0]?.message.content
      if (!content) throw new GenerationError('Model returned no widget')
      return widgetSchema.parse(JSON.parse(content))
    } catch (error) {
      if (error instanceof GenerationError) throw error
      if (error instanceof OpenAI.APIError && error.status === 402) {
        throw new GenerationError('Demo generation budget exhausted', 402)
      }
      if (error instanceof OpenAI.APIError && error.status === 429) {
        throw new GenerationError('The model is busy. Try again shortly.', 429)
      }
      throw new GenerationError(error instanceof Error ? error.message : 'Widget generation failed')
    }
  }
}

export { GENERATOR_VERSION }
