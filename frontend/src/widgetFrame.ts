import type { WidgetCode } from './api'

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
].join('; ')

// Runs before the widget's own JS: reports size and runtime errors to the parent.
const BRIDGE = `
(function () {
  function send(msg) { parent.postMessage(Object.assign({ __intaged: true }, msg), '*'); }
  window.addEventListener('error', function (e) {
    send({ type: 'error', message: (e.message || 'Error') + (e.lineno ? ' (line ' + e.lineno + ')' : '') });
  });
  window.addEventListener('unhandledrejection', function (e) {
    send({ type: 'error', message: 'Unhandled rejection: ' + String(e.reason) });
  });
  document.addEventListener('securitypolicyviolation', function (e) {
    send({ type: 'error', message: 'Blocked by sandbox: ' + e.violatedDirective + ' ' + e.blockedURI });
  });
  function resize() { send({ type: 'resize', height: document.documentElement.scrollHeight }); }
  new ResizeObserver(resize).observe(document.documentElement);
  window.addEventListener('load', resize);
})();
`

// Prevent user code from closing our tags early.
const escapeScript = (s: string) => s.replace(/<\/script/gi, '<\\/script')
const escapeStyle = (s: string) => s.replace(/<\/style/gi, '<\\/style')

export function buildSrcdoc(code: WidgetCode): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; background: transparent; font-family: system-ui, sans-serif; }
  body { padding: 12px; box-sizing: border-box; overflow: hidden; }
  *, *::before, *::after { box-sizing: inherit; }
</style>
<style>${escapeStyle(code.css)}</style>
<script>${BRIDGE}</script>
</head>
<body>
${code.html}
<script>${escapeScript(code.js)}</script>
</body>
</html>`
}

export interface FrameMessage {
  __intaged: true
  type: 'resize' | 'error'
  height?: number
  message?: string
}

export function isFrameMessage(data: unknown): data is FrameMessage {
  return typeof data === 'object' && data !== null && (data as FrameMessage).__intaged === true
}
