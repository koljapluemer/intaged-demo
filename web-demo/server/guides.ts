export const GUIDES = {
  sandbox: `# Sandbox runtime
- The widget runs in an iframe with an opaque origin. body.html is inserted into <body>, then the bundled main.ts runs once.
- Imports: relative files and npm packages added with add_dependency. CSS imported from packages (\`import 'leaflet/dist/leaflet.css'\`) and assets referenced by CSS are inlined.
- No network by default. fetch/XHR/WebSocket to other hosts and remote images, fonts or scripts are blocked. Map tile hosts can be allowed with the network field of write_files (or set_network).
- localStorage, sessionStorage, cookies, alert/confirm/prompt and window.open are unavailable. Keep state in memory.
- Web workers only work from blob: URLs. Prefer packages that do not need workers, or configure them to run on the main thread.
- Hardcode plausible sample data when data is needed.
- The iframe grows to the document height automatically, without a limit. Avoid height: 100vh; give charts an explicit or aspect-ratio-based height.`,

  design: `# Design
Theme variables are defined on :root and switch with prefers-color-scheme:
- --wk-font, --wk-font-mono
- --wk-fg (primary text), --wk-fg-muted (secondary text), --wk-bg (transparent page), --wk-surface (cards, tooltips), --wk-border, --wk-grid (gridlines), --wk-accent
- --wk-c1 … --wk-c8: categorical series colors in this fixed order (blue, orange, aqua, yellow, magenta, green, violet, red)
- --wk-seq-100 … --wk-seq-700: single-hue sequential ramp for magnitude (light = low)
- --wk-good, --wk-warning, --wk-critical: status only, always with a label or icon
- --wk-radius
Read values in JS with getComputedStyle(document.documentElement).getPropertyValue('--wk-c1').trim(). Charting libraries need concrete colors, so read them at startup and again on matchMedia('(prefers-color-scheme: dark)') change.

Rules:
- Fill the available width, from narrow phones (320px) upward with no maximum. Take whatever height the content needs. Use a ResizeObserver to redraw on width change.
- Assign series colors in slot order; never cycle or generate hues. More than 8 categories: fold into "Other".
- Text uses --wk-fg / --wk-fg-muted, never the series color. Gridlines and axes are recessive (--wk-grid).
- Two or more series need a legend. Add hover tooltips on marks (--wk-surface background, --wk-border).
- Never use a dual y-axis. Thin marks, 2px lines, rounded bar ends where the library allows.
- Controls (buttons, sliders, selects) use native elements styled with the variables, in one row above the visual.`,

  charts: `# Charts
Good default choices:
- @observablehq/plot: concise statistical charts. Plot.plot({...}) returns an SVG/figure element to append. Set width from the container and re-render on resize. Use \`color: { range: [...] }\` with the --wk-c* values.
- echarts: rich interactive charts, tooltips and zoom built in. Use echarts.init(el, null, { renderer: 'svg' }), call chart.resize() from a ResizeObserver. Import only what you need via 'echarts/core' to keep the bundle small.
- chart.js: canvas charts. Register components (\`import Chart from 'chart.js/auto'\`). Set maintainAspectRatio: false and give the parent an explicit height.
- d3 (or individual d3-* modules): custom visualizations. Prefer d3-scale, d3-shape, d3-selection etc. for smaller bundles.
Check the exact API with package_docs before using unfamiliar options.`,

  maps: `# Maps
- leaflet: import L from 'leaflet' and import 'leaflet/dist/leaflet.css'. Tiles: https://tile.openstreetmap.org/{z}/{x}/{y}.png (allow tile.openstreetmap.org via write_files network). Include the OSM attribution. Default marker icons reference image files; use L.circleMarker or L.divIcon instead.
- maplibre-gl: vector maps. import 'maplibre-gl/dist/maplibre-gl.css'. Style URL https://tiles.openfreemap.org/styles/liberty (allow tiles.openfreemap.org). MapLibre needs workers; this may fail in the sandbox, so prefer Leaflet with raster tiles.
- CARTO basemaps (light_all / dark_all raster) are at https://{s}.basemaps.cartocdn.com/... (allow basemaps.cartocdn.com). Pick the dark style when prefers-color-scheme is dark.
- Give the map container an explicit height (e.g. 360px).`,

  '3d': `# 3D
- three: import * as THREE from 'three'; addons from 'three/addons/...'. Size the renderer from the container width with a fixed height, update camera aspect and renderer size in a ResizeObserver, and call renderer.setPixelRatio(Math.min(devicePixelRatio, 2)).
- Use setAnimationLoop and keep the scene light. Use a transparent clear color (renderer.setClearAlpha(0)) so the page background shows through.`,
} as const
