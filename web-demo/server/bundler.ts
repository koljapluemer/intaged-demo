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

const run = promisify(execFile)

export type BuildResult =
  | { ok: true; hash: string; bytes: number; warnings: string[] }
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

// Keeps imports inside the workspace and the installed packages, so a crafted spec cannot inline server files.
function confine(roots: string[]): Plugin {
  return {
    name: 'confine',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.confined) return undefined
        const result = await builder.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { confined: true },
        })
        if (result.errors.length || result.external || result.namespace !== 'file') return result
        if (roots.some((root) => within(result.path, root))) return result
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

export class Bundler {
  private readonly installs = new Map<string, Promise<string>>()

  constructor(
    private readonly dirs = { bundles: config.bundlesDir, packages: config.packagesDir, npmCache: config.npmCacheDir },
  ) {}

  async initialize() {
    await Promise.all(Object.values(this.dirs).map((dir) => mkdir(dir, { recursive: true })))
  }

  /** Installs exact dependency versions once per set and returns the node_modules directory. */
  ensureInstalled(deps: Record<string, string>): Promise<string> {
    const sorted = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)))
    const key = sha256(JSON.stringify(sorted))
    let pending = this.installs.get(key)
    if (!pending) {
      pending = this.install(key, sorted)
      pending.catch(() => this.installs.delete(key))
      this.installs.set(key, pending)
    }
    return pending
  }

  async build(source: WidgetSource): Promise<BuildResult> {
    let nodeModules: string | undefined
    if (Object.keys(source.deps).length) {
      try {
        nodeModules = await this.ensureInstalled(source.deps)
      } catch (error) {
        return { ok: false, diagnostics: [error instanceof Error ? error.message : String(error)] }
      }
    }

    const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'theadoc-build-')))
    try {
      await Promise.all(
        Object.entries(source.files).map(([name, contents]) => writeFile(path.join(workspace, name), contents)),
      )
      const imports = ['style.css', 'main.ts', 'main.js'].filter((name) => name in source.files)
      await writeFile(path.join(workspace, ENTRY), imports.map((name) => `import './${name}'`).join('\n'))

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
        nodePaths: nodeModules ? [nodeModules] : [],
        loader: assetLoaders,
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [confine([workspace, ...(nodeModules ? [nodeModules] : [])])],
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
    const nodeModules = path.join(directory, 'node_modules')
    if (await exists(path.join(directory, '.ready'))) return nodeModules

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
    return nodeModules
  }
}

async function exists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  )
}
