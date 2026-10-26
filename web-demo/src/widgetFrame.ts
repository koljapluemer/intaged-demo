import type { LibName, WidgetArtifact } from './types'

const libCache = new Map<LibName, Promise<string>>()
const filenames: Record<LibName, string> = {
  leaflet: 'leaflet.js',
  d3: 'd3.js',
  chartjs: 'chartjs.js',
  three: 'three.js',
  svgjs: 'svgjs.js',
  lucide: 'lucide.js',
}

function scriptText(value: string) {
  return value.split('</script').join('<\\/script')
}

async function librarySource(name: LibName): Promise<string> {
  let pending = libCache.get(name)
  if (!pending) {
    pending = Promise.all([
      fetch(`/vendor/${filenames[name]}`).then((response) => {
        if (!response.ok) throw new Error(`Could not load ${name}`)
        return response.text()
      }),
      name === 'leaflet'
        ? fetch('/vendor/leaflet.css').then((response) => response.text())
        : Promise.resolve(''),
    ]).then(([script, css]) => `${css ? `<style>${css}</style>` : ''}<script>${scriptText(script)}</script>`)
    libCache.set(name, pending)
  }
  return pending
}

export async function buildWidgetDocument(widget: WidgetArtifact): Promise<string> {
  const libraries = (await Promise.all(widget.libs.map(librarySource))).join('\n')
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: https://tile.openstreetmap.org",
    "connect-src 'none'",
    "font-src 'none'",
  ].join('; ')
  const bridge = `
    const sendHeight = () => parent.postMessage({ source: 'theadoc-widget', type: 'resize', height: document.documentElement.scrollHeight }, '*');
    addEventListener('error', event => parent.postMessage({ source: 'theadoc-widget', type: 'error', message: event.message }, '*'));
    addEventListener('unhandledrejection', event => parent.postMessage({ source: 'theadoc-widget', type: 'error', message: String(event.reason) }, '*'));
    new ResizeObserver(sendHeight).observe(document.documentElement);
    sendHeight();
  `
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;background:transparent} ${widget.css}</style>${libraries}</head><body>${widget.html}<script>${scriptText(widget.js)}\n${bridge}</script></body></html>`
}

export function isWidgetMessage(value: unknown): value is { source: string; type: string; height?: number; message?: string } {
  return typeof value === 'object' && value !== null && (value as { source?: string }).source === 'theadoc-widget'
}
