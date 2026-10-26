import { getBundle } from './api'
import type { WidgetArtifact, WidgetBundle } from './types'

const bundleCache = new Map<string, Promise<WidgetBundle>>()

// Design tokens documented to the generator in server/guides.ts (design topic).
const THEME = `
:root {
  color-scheme: light dark;
  --wk-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --wk-font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --wk-radius: 6px;
  --wk-bg: transparent;
  --wk-fg: #0b0b0b; --wk-fg-muted: #52514e; --wk-surface: #fcfcfb; --wk-border: #e2e1dc; --wk-grid: #ebeae6;
  --wk-accent: #2a78d6;
  --wk-c1: #2a78d6; --wk-c2: #eb6834; --wk-c3: #1baf7a; --wk-c4: #eda100;
  --wk-c5: #e87ba4; --wk-c6: #008300; --wk-c7: #6250d6; --wk-c8: #e34948;
  --wk-seq-100: #cde2fb; --wk-seq-200: #9ec5f4; --wk-seq-300: #6da7ec; --wk-seq-400: #3987e5;
  --wk-seq-500: #256abf; --wk-seq-600: #184f95; --wk-seq-700: #0d366b;
  --wk-good: #0ca30c; --wk-warning: #fab219; --wk-critical: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --wk-fg: #f0efec; --wk-fg-muted: #c3c2b7; --wk-surface: #1a1a19; --wk-border: #383835; --wk-grid: #2c2c2a;
    --wk-accent: #3987e5;
    --wk-c1: #3987e5; --wk-c2: #d95926; --wk-c3: #199e70; --wk-c4: #c98500;
    --wk-c5: #d55181; --wk-c6: #008300; --wk-c7: #9085e9; --wk-c8: #e66767;
  }
}
html, body { margin: 0; background: var(--wk-bg); color: var(--wk-fg); font-family: var(--wk-font); }
`

function scriptText(value: string) {
  return value.split('</script').join('<\\/script')
}

function styleText(value: string) {
  return value.split('</style').join('<\\/style')
}

function loadBundle(hash: string): Promise<WidgetBundle> {
  let pending = bundleCache.get(hash)
  if (!pending) {
    pending = getBundle(hash)
    pending.catch(() => bundleCache.delete(hash))
    bundleCache.set(hash, pending)
  }
  return pending
}

export function widgetCsp(network: readonly string[]) {
  // Tile servers commonly shard across subdomains ({s}.basemaps.cartocdn.com).
  const hosts = network.flatMap((host) => [`https://${host}`, `https://*.${host}`]).join(' ')
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob:${hosts ? ` ${hosts}` : ''}`,
    `font-src data:${hosts ? ` ${hosts}` : ''}`,
    `connect-src ${hosts || "'none'"}`,
    'worker-src blob:',
  ].join('; ')
}

export async function buildWidgetDocument(widget: WidgetArtifact): Promise<string> {
  const bundle = await loadBundle(widget.bundle)
  const bridge = `
    const sendHeight = () => parent.postMessage({ source: 'theadoc-widget', type: 'resize', height: document.documentElement.scrollHeight }, '*');
    addEventListener('error', event => parent.postMessage({ source: 'theadoc-widget', type: 'error', message: event.message }, '*'));
    addEventListener('unhandledrejection', event => parent.postMessage({ source: 'theadoc-widget', type: 'error', message: String(event.reason) }, '*'));
    new ResizeObserver(sendHeight).observe(document.documentElement);
    sendHeight();
  `
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${widgetCsp(widget.network)}"><style>${THEME}</style><style>${styleText(bundle.css)}</style><script>${bridge}</script></head><body>${widget.files['body.html'] ?? ''}<script>${scriptText(bundle.js)}</script></body></html>`
}

export function isWidgetMessage(value: unknown): value is { source: string; type: string; height?: number; message?: string } {
  return typeof value === 'object' && value !== null && (value as { source?: string }).source === 'theadoc-widget'
}
