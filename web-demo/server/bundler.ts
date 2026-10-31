import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { build, type Message, type Plugin } from 'esbuild'
import type { WidgetBundle, WidgetSource } from '../src/types.js'
import { bundleHash, writeFileAtomic } from './artifacts.js'
import { config } from './config.js'
import { isPackageName } from './packages.js'

const run = promisify(execFile)

export type BuildResult =
  /** `preinstalled` lists the preinstalled packages the workspace imports, with their versions. */
  | { ok: true; hash: string; bytes: number; warnings: string[]; preinstalled: Record<string, string> }
  | { ok: false; diagnostics: string[] }

export class InstallError extends Error {}

const ENTRY = '__entry.js'

const assetLoaders = {
  '.png': 'dataurl',
  '.jpg': 'dataurl',
  '.jpeg': 'dataurl',
  '.gif': 'dataurl',
  '.webp': 'dataurl',
  '.svg': 'dataurl',
  '.woff': 'dataurl',
  '.woff2': 'dataurl',
  '.ttf': 'dataurl',
  '.otf': 'dataurl',
} as const

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function within(file: string, directory: string) {
  return file.startsWith(directory + path.sep)
}

/** The package a bare import specifier refers to (`@scope/name/sub` → `@scope/name`), or null for paths. */
export function packageName(specifier: string): string | null {
  if (/^[./]/.test(specifier) || specifier.includes(':')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? (parts.length > 1 ? parts.slice(0, 2).join('/') : null) : parts[0]
}

interface Roots {
  workspace: string
  /** Directory whose node_modules holds the workspace's extra (not preinstalled) dependencies. */
  extras: { root: string; names: Set<string> } | null
  /** Directory whose node_modules holds the preinstalled packages. */
  base: string | null
}

/**
 * Resolves the workspace's bare imports from the extra dependencies or the preinstalled packages, and keeps
 * every import inside those directories, so a crafted spec cannot inline server files. Packages resolve their
 * own imports from where they are installed.
 */
function resolveWidgetImports(roots: Roots, baseVersion: (name: string) => Promise<string | null>, used: Map<string, string>): Plugin {
  const allowed = [roots.workspace, roots.extras?.root, roots.base]
    .filter((root): root is string => Boolean(root))
    .map((root) => (root === roots.workspace ? root : path.join(root, 'node_modules')))
  return {
    name: 'widget-imports',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.confined) return undefined
        let resolveDir = args.resolveDir
        const name = within(args.importer, roots.workspace) ? packageName(args.path) : null
        if (name && !isBuiltin(name)) {
          if (roots.extras?.names.has(name)) {
            resolveDir = roots.extras.root
          } else if (roots.base) {
            const version = await baseVersion(name)
            if (version) {
              resolveDir = roots.base
              used.set(name, version)
            }
          }
        }
        const result = await builder.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir,
          pluginData: { confined: true },
        })
        if (result.errors.length || result.external || result.namespace !== 'file') return result
        if (allowed.some((root) => within(result.path, root))) return result
        return { errors: [{ text: `Import "${args.path}" is outside the widget workspace` }] }
      })
    },
  }
}

function formatMessage(message: Message, root: string) {
  const location = message.location
  const where = location ? `${path.relative(root, path.resolve(root, location.file))}:${location.line}:${location.column}: ` : ''
  let text = `${where}${message.text}`
  const unresolved = /^Could not resolve "([^"]+)"/.exec(message.text)?.[1]
  if (unresolved && !unresolved.startsWith('.')) {
    text += isBuiltin(unresolved)
      ? ' (Node built-in, unavailable in the browser)'
      : ' (call add_dependency for this package)'
  }
  return text
}

interface BundlerDirs {
  bundles: string
  packages: string
  npmCache: string
  /** Directory with a package.json and installed node_modules of packages every widget can import. */
  base?: string
}

export class Bundler {
  private readonly installs = new Map<string, Promise<string>>()
  private readonly baseVersions = new Map<string, Promise<string | null>>()
  private base: string | null = null
  /** The declared preinstalled packages and their installed versions. */
  preinstalled: Record<string, string> = {}

  constructor(
    private readonly dirs: BundlerDirs = {
      bundles: config.bundlesDir,
      packages: config.packagesDir,
      npmCache: config.npmCacheDir,
      base: config.widgetBaseDir,
    },
  ) {}

  async initialize() {
    await Promise.all([this.dirs.bundles, this.dirs.packages, this.dirs.npmCache].map((dir) => mkdir(dir, { recursive: true })))
    if (!this.dirs.base) return
    const manifest = await readFile(path.join(this.dirs.base, 'package.json'), 'utf8').catch(() => null)
    const declared = Object.keys((manifest ? JSON.parse(manifest).dependencies : null) ?? {})
    if (!(await exists(path.join(this.dirs.base, 'node_modules')))) {
      if (declared.length) console.warn(`preinstalled widget packages missing: run npm ci in ${this.dirs.base}`)
      return
    }
    this.base = this.dirs.base
    for (const name of declared) {
      const version = await this.baseVersion(name)
      if (version) this.preinstalled[name] = version
    }
  }

  /** The installed version of a preinstalled package, including packages they depend on (e.g. d3-scale). */
  baseVersion(name: string): Promise<string | null> {
    const base = this.base
    if (!base || !isPackageName(name)) return Promise.resolve(null)
    let version = this.baseVersions.get(name)
    if (!version) {
      version = readFile(path.join(base, 'node_modules', name, 'package.json'), 'utf8').then(
        (text) => (JSON.parse(text) as { version?: string }).version ?? null,
        () => null,
      )
      this.baseVersions.set(name, version)
    }
    return version
  }

  /**
   * Installs the dependencies that the preinstalled packages do not already provide at the exact version,
   * once per set, and returns the directory holding their node_modules (null when nothing needs installing).
   */
  async ensureInstalled(deps: Record<string, string>): Promise<string | null> {
    const extras = await this.extras(deps)
    if (!Object.keys(extras).length) return null
    const key = sha256(JSON.stringify(extras))
    let pending = this.installs.get(key)
    if (!pending) {
      pending = this.install(key, extras)
      pending.catch(() => this.installs.delete(key))
      this.installs.set(key, pending)
    }
    return pending
  }

  /** The installed directory of a dependency or preinstalled package, or null. */
  async packageDir(deps: Record<string, string>, name: string): Promise<string | null> {
    const extras = await this.extras(deps)
    const root = name in extras ? await this.ensureInstalled(deps) : (await this.baseVersion(name)) ? this.base : null
    return root ? path.join(root, 'node_modules', name) : null
  }

  private async extras(deps: Record<string, string>) {
    const entries = await Promise.all(
      Object.entries(deps).map(async ([name, version]) => [name, version, (await this.baseVersion(name)) === version] as const),
    )
    return Object.fromEntries(
      entries
        .filter(([, , preinstalled]) => !preinstalled)
        .map(([name, version]) => [name, version])
        .sort(([a], [b]) => a.localeCompare(b)),
    ) as Record<string, string>
  }

  async build(source: WidgetSource): Promise<BuildResult> {
    let extrasRoot: string | null
    try {
      extrasRoot = await this.ensureInstalled(source.deps)
    } catch (error) {
      return { ok: false, diagnostics: [error instanceof Error ? error.message : String(error)] }
    }
    const extraNames = new Set(Object.keys(await this.extras(source.deps)))

    const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'theadoc-build-')))
    try {
      await Promise.all(
        Object.entries(source.files).map(([name, contents]) => writeFile(path.join(workspace, name), contents)),
      )
      const imports = ['style.css', 'main.ts', 'main.js'].filter((name) => name in source.files)
      await writeFile(path.join(workspace, ENTRY), imports.map((name) => `import './${name}'`).join('\n'))
      const used = new Map<string, string>()

      const result = await build({
        absWorkingDir: workspace,
        entryPoints: [ENTRY],
        outdir: 'out',
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        minify: true,
        legalComments: 'none',
        logLevel: 'silent',
        loader: assetLoaders,
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [
          resolveWidgetImports(
            { workspace, extras: extrasRoot ? { root: extrasRoot, names: extraNames } : null, base: this.base },
            (name) => this.baseVersion(name),
            used,
          ),
        ],
      }).catch((error: { errors?: Message[] }) => {
        if (!error.errors) throw error
        return { errors: error.errors }
      })
      if (!('outputFiles' in result)) {
        return { ok: false, diagnostics: result.errors.slice(0, 20).map((message) => formatMessage(message, workspace)) }
      }

      const output = (extension: string) => result.outputFiles?.find((file) => file.path.endsWith(extension))?.text ?? ''
      const bundle: WidgetBundle = { js: output('.js'), css: output('.css') }
      const text = JSON.stringify(bundle)
      const bytes = Buffer.byteLength(text)
      if (bytes > config.maxBundleBytes) {
        return {
          ok: false,
          diagnostics: [`Bundle is ${bytes} bytes, above the ${config.maxBundleBytes} byte limit; use lighter packages or deep imports`],
        }
      }
      const hash = sha256(text)
      const target = this.bundleFile(hash)
      if (!(await exists(target))) await writeFileAtomic(target, text)
      return {
        ok: true,
        hash,
        bytes,
        warnings: result.warnings.slice(0, 10).map((message) => formatMessage(message, workspace)),
        preinstalled: Object.fromEntries([...used].sort(([a], [b]) => a.localeCompare(b))),
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }

  async getBundle(hash: string): Promise<string | null> {
    if (!bundleHash.safeParse(hash).success) return null
    return readFile(this.bundleFile(hash), 'utf8').catch(() => null)
  }

  private bundleFile(hash: string) {
    return path.join(this.dirs.bundles, `${hash}.json`)
  }

  private async install(key: string, deps: Record<string, string>): Promise<string> {
    const directory = path.join(this.dirs.packages, key)
    if (await exists(path.join(directory, '.ready'))) return directory

    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: 'theadoc-widget-deps', private: true, dependencies: deps }),
    )
    try {
      await run(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error', '--cache', this.dirs.npmCache],
        {
          cwd: directory,
          timeout: config.installTimeoutMs,
          maxBuffer: 4_000_000,
          env: { ...process.env, npm_config_update_notifier: 'false' },
        },
      )
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      const stderr = (error as { stderr?: string }).stderr?.trim().split('\n').slice(-5).join('\n')
      throw new InstallError(`Installing ${Object.keys(deps).join(', ')} failed${stderr ? `:\n${stderr}` : ''}`)
    }
    await writeFile(path.join(directory, '.ready'), '')
    return directory
  }
}

async function exists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  )
}
