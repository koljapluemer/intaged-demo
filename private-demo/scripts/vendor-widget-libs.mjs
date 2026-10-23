import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve('public/vendor')
await mkdir(out, { recursive: true })

const copies = {
  'leaflet.js': 'leaflet/dist/leaflet.js',
  'd3.js': 'd3/dist/d3.min.js',
  'chartjs.js': 'chart.js/dist/chart.umd.min.js',
  'svgjs.js': '@svgdotjs/svg.js/dist/svg.min.js',
  'lucide.js': 'lucide/dist/umd/lucide.min.js',
}

await Promise.all(
  Object.entries(copies).map(([target, source]) => copyFile(path.join('node_modules', source), path.join(out, target))),
)

await build({
  stdin: { contents: "export * from 'three'", resolveDir: '.' },
  bundle: true,
  format: 'iife',
  globalName: 'THREE',
  minify: true,
  outfile: path.join(out, 'three.js'),
  platform: 'browser',
  logLevel: 'silent',
})

let leafletCss = await readFile('node_modules/leaflet/dist/leaflet.css', 'utf8')
for (const file of ['layers.png', 'layers-2x.png', 'marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png']) {
  const bytes = await readFile(path.join('node_modules/leaflet/dist/images', file))
  leafletCss = leafletCss.replaceAll(`url(images/${file})`, `url(data:image/png;base64,${bytes.toString('base64')})`)
}
await writeFile(path.join(out, 'leaflet.css'), leafletCss)
