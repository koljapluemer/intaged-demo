// The fixed catalog of libraries a widget may use. Each loads lazily, as text that
// widgetFrame inlines into the sandbox, plus any network origins it needs.
export interface LibAssets {
  scripts: string[]
  styles: string[]
  imgSrc: string[]
}

const text = (m: { default: string }) => m.default

async function leaflet(): Promise<LibAssets> {
  const [js, css, icon, icon2x, shadow] = await Promise.all([
    import('./vendor/leaflet.js?raw').then(text),
    import('./vendor/leaflet.css?raw').then(text),
    import('./vendor/marker-icon.png?inline').then(text),
    import('./vendor/marker-icon-2x.png?inline').then(text),
    import('./vendor/marker-shadow.png?inline').then(text),
  ])
  // Leaflet's default marker images are relative URLs, which don't resolve in a srcdoc frame.
  const icons = JSON.stringify({ iconUrl: icon, iconRetinaUrl: icon2x, shadowUrl: shadow })
  const setup = `L.Icon.Default.imagePath = ''; L.Icon.Default.mergeOptions(${icons});`
  return { scripts: [js, setup], styles: [css], imgSrc: ['https://tile.openstreetmap.org'] }
}

const script = (load: () => Promise<{ default: string }>) => async (): Promise<LibAssets> => ({
  scripts: [text(await load())],
  styles: [],
  imgSrc: [],
})

const LIBS: Record<string, () => Promise<LibAssets>> = {
  leaflet,
  d3: script(() => import('./vendor/d3.js?raw')),
  chartjs: script(() => import('./vendor/chart.js?raw')),
  three: script(() => import('./vendor/three.js?raw')),
  svgjs: script(() => import('./vendor/svg.js?raw')),
  lucide: script(() => import('./vendor/lucide.js?raw')),
}

/** Loads and merges the assets of the named libraries; unknown names are ignored. */
export async function loadLibs(names: string[]): Promise<LibAssets> {
  const loaded = await Promise.all(names.filter((n) => n in LIBS).map((n) => LIBS[n]!()))
  return {
    scripts: loaded.flatMap((l) => l.scripts),
    styles: loaded.flatMap((l) => l.styles),
    imgSrc: loaded.flatMap((l) => l.imgSrc),
  }
}
