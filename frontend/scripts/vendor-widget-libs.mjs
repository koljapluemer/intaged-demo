// Collects the browser builds of the widget library catalog into src/vendor/,
// where src/widgetLibs.ts inlines them into widget frames.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

const OUT = 'src/vendor'

// Official global (UMD) builds, copied as-is.
const COPY = {
  'leaflet.js': 'leaflet/dist/leaflet.js',
  'leaflet.css': 'leaflet/dist/leaflet.css',
  'marker-icon.png': 'leaflet/dist/images/marker-icon.png',
  'marker-icon-2x.png': 'leaflet/dist/images/marker-icon-2x.png',
  'marker-shadow.png': 'leaflet/dist/images/marker-shadow.png',
  'd3.js': 'd3/dist/d3.min.js',
  'chart.js': 'chart.js/dist/chart.umd.min.js',
  'svg.js': '@svgdotjs/svg.js/dist/svg.min.js',
  'lucide.js': 'lucide/dist/umd/lucide.min.js',
}

mkdirSync(OUT, { recursive: true })
for (const [name, source] of Object.entries(COPY)) {
  copyFileSync(`node_modules/${source}`, `${OUT}/${name}`)
}

// three.js ships only ES modules, so bundle it into a script exposing `THREE`.
await build({
  stdin: { contents: "export * from 'three'", resolveDir: '.' },
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'THREE',
  outfile: `${OUT}/three.js`,
  logLevel: 'warning',
})
