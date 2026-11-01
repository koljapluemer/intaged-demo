import { describe, expect, it } from 'vitest'
import { createRoutes } from './models.js'

describe('createRoutes', () => {
  it('needs an OpenRouter key', () => {
    expect(createRoutes({ google: 'g', openRouter: '' })).toBeNull()
  })

  it('runs OpenRouter alone without a Gemini key', () => {
    const routes = createRoutes({ google: '', openRouter: 'o' })
    expect(routes?.primaries.map((route) => route.label)).toEqual(['openrouter/openai/gpt-5.6-terra'])
    expect(routes?.fallback).toBeUndefined()
  })

  it('tries the Gemini chain before the OpenRouter fallback, failing fast on each Gemini model', () => {
    const routes = createRoutes({ google: 'g', openRouter: 'o' })
    expect(routes?.primaries.map((route) => route.label)).toEqual([
      'google/gemini-3.8-flash',
      'google/gemini-3.6-flash',
      'google/gemini-3.5-flash-lite',
      'google/gemini-3.1-flash-lite',
    ])
    expect(routes?.primaries.every((route) => route.maxRetries === 0)).toBe(true)
    expect(routes?.fallback).toMatchObject({
      label: 'openrouter/openai/gpt-5.6-terra',
      providerOptions: { openrouter: { reasoning: { effort: 'low' } } },
    })
  })
})
