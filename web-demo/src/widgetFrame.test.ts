import { describe, expect, it } from 'vitest'
import { widgetCsp } from './widgetFrame'

describe('widgetCsp', () => {
  it('blocks the network unless hosts are allowed', () => {
    expect(widgetCsp([])).toContain("connect-src 'none'")
    expect(widgetCsp([])).toContain('img-src data: blob:;')
  })

  it('allows opted-in hosts for images, fonts and connections only', () => {
    const csp = widgetCsp(['tile.openstreetmap.org'])
    expect(csp).toContain('img-src data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org;')
    expect(csp).toContain('connect-src https://tile.openstreetmap.org https://*.tile.openstreetmap.org;')
    expect(csp).toContain("script-src 'unsafe-inline';")
  })
})
