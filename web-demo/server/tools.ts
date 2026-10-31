import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { tool } from 'ai'
import semver from 'semver'
import { z } from 'zod'
import { NETWORK_HOSTS } from '../src/types.js'
import type { Bundler } from './bundler.js'
import type { PackageRegistry } from './packages.js'
import type { Workspace } from './workspace.js'

const DOC_LIMIT = 12_000
const DOC_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts', '.md', '.ts', '.js', '.mjs', '.json']

interface ToolDeps {
  workspace: Workspace
  registry: PackageRegistry
  bundler: Bundler
}

// Tool failures go back to the model as text so it can correct course instead of aborting the loop.
async function attempt<T>(work: () => T | Promise<T>): Promise<T | string> {
  try {
    return await work()
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

function truncate(text: string, limit = DOC_LIMIT) {
  return text.length > limit ? `${text.slice(0, limit)}\n… [truncated, ${text.length - limit} more characters]` : text
}

function typesEntry(manifest: Record<string, unknown>): string | undefined {
  const direct = (manifest.types ?? manifest.typings) as string | undefined
  if (direct) return direct
  const root = (manifest.exports as Record<string, unknown> | undefined)?.['.']
  if (root && typeof root === 'object') {
    const entry = root as Record<string, unknown>
    const types = entry.types ?? (entry.import as Record<string, unknown> | undefined)?.types
    if (typeof types === 'string') return types
  }
  return undefined
}

async function packageDocs({ workspace, bundler }: ToolDeps, name: string, file?: string) {
  const directory = name in workspace.deps || name in bundler.preinstalled ? await bundler.packageDir(workspace.deps, name) : null
  if (!directory) throw new Error(`Add ${name} with add_dependency before reading its docs`)
  const root = await realpath(directory)

  if (file) {
    const target = await realpath(path.resolve(root, file))
    if (!target.startsWith(root + path.sep)) throw new Error('Path must stay inside the package')
    if (!DOC_EXTENSIONS.some((extension) => target.endsWith(extension))) throw new Error('Only source, type and markdown files can be read')
    return truncate(await readFile(target, 'utf8'))
  }

  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>
  const entries = await readdir(root)
  const readme = entries.find((entry) => /^readme(\.md|\.markdown)?$/i.test(entry))
  const types = typesEntry(manifest) ?? (entries.includes('index.d.ts') ? 'index.d.ts' : undefined)
  const sections = [`# ${name}@${String(manifest.version)}`, `Files: ${entries.join(', ')}`]
  if (types) sections.push(`## Types (${types})\n${truncate(await readFile(path.join(root, types), 'utf8').catch(() => 'unreadable'), 6_000)}`)
  if (readme) sections.push(`## README\n${await readFile(path.join(root, readme), 'utf8')}`)
  return truncate(sections.join('\n\n'))
}

const MORE = z
  .boolean()
  .optional()
  .describe('true only if you will make further changes before the widget is complete; omit otherwise')

export function createTools(deps: ToolDeps) {
  const { workspace, registry, bundler } = deps

  // Tools run in parallel within a step; changes to the workspace apply one at a time, in the order called.
  let changes: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = changes.then(work)
    changes = result.catch(() => undefined)
    return result
  }

  const build = async () => {
    const result = await bundler.build(workspace.source)
    workspace.recordBuild(result)
    if ('diagnostics' in result) return { ok: false, diagnostics: result.diagnostics }
    return {
      ok: true,
      bytes: result.bytes,
      warnings: result.warnings,
      ...(workspace.finished ? { delivered: 'The widget is complete and delivered. Stop here.' } : {}),
    }
  }
  // Dependency changes only need a build once files have been built against the old set.
  const rebuildIfBuilt = async (summary: object) => (workspace.hasBuilt ? { ...summary, build: await build() } : summary)

  return {
    search_packages: tool({
      description: 'Search npm for browser packages. Returns name, latest version, description and weekly downloads.',
      inputSchema: z.object({ query: z.string().min(2).max(100) }),
      execute: ({ query }) => attempt(() => registry.search(query)),
    }),
    add_dependency: tool({
      description:
        'Add an npm package that is not preinstalled (resolves an exact version and installs it). Rebuilds if the workspace was built before.',
      inputSchema: z.object({
        name: z.string(),
        range: z.string().optional().describe('semver range or dist-tag; defaults to latest'),
      }),
      execute: ({ name, range }) =>
        exclusive(() =>
          attempt(async () => {
            const preinstalled = await bundler.baseVersion(name)
            const usePreinstalled =
              preinstalled && (!range || range === 'latest' || semver.satisfies(preinstalled, range))
            const resolved = usePreinstalled
              ? { name, version: preinstalled, notes: ['Preinstalled.'] }
              : await registry.resolve(name, range)
            await bundler.ensureInstalled({ ...workspace.deps, [resolved.name]: resolved.version })
            workspace.setDependency(resolved.name, resolved.version)
            return rebuildIfBuilt({ added: `${resolved.name}@${resolved.version}`, notes: resolved.notes })
          }),
        ),
    }),
    remove_dependency: tool({
      description: 'Remove an npm package from the workspace. Rebuilds if the workspace was built before.',
      inputSchema: z.object({ name: z.string() }),
      execute: ({ name }) =>
        exclusive(() =>
          attempt(() => {
            workspace.setDependency(name, null)
            return rebuildIfBuilt({ removed: name })
          }),
        ),
    }),
    package_docs: tool({
      description:
        'Read an added or preinstalled package: its file list, type declarations and README. Pass path to read a specific file inside the package, e.g. a .d.ts file.',
      inputSchema: z.object({ name: z.string(), path: z.string().optional() }),
      execute: ({ name, path: file }) => attempt(() => packageDocs(deps, name, file)),
    }),
    list_files: tool({
      description: 'List workspace files, dependencies and allowed network hosts.',
      inputSchema: z.object({}),
      execute: () => ({ files: workspace.list(), deps: workspace.deps, network: workspace.network }),
    }),
    read_file: tool({
      description: 'Read a workspace file.',
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path: name }) => attempt(() => workspace.read(name)),
    }),
    write_files: tool({
      description:
        'Create or replace workspace files with their full contents (and optionally delete files), then build. Returns build errors with file:line:column. When the build succeeds the widget is delivered, unless more is true.',
      inputSchema: z.object({
        files: z.array(z.object({ path: z.string(), content: z.string() })).max(20),
        delete: z.array(z.string()).optional(),
        network: z
          .array(z.enum(NETWORK_HOSTS))
          .optional()
          .describe('hosts the widget may load map tiles from, same as set_network; omit to keep the current list'),
        more: MORE,
      }),
      execute: ({ files, delete: removed, network, more }) =>
        exclusive(() =>
          attempt(() => {
            workspace.transaction(() => {
              for (const file of files) workspace.write(file.path, file.content)
              for (const name of removed ?? []) workspace.delete(name)
            }, !more)
            if (network) workspace.setNetwork(network)
            return build()
          }),
        ),
    }),
    edit_files: tool({
      description:
        'Replace exact, unique occurrences of old_text with new_text, across one or more workspace files, then build. Edits apply in order and all or none. When the build succeeds the widget is delivered, unless more is true.',
      inputSchema: z.object({
        edits: z.array(z.object({ path: z.string(), old_text: z.string(), new_text: z.string() })).min(1).max(50),
        more: MORE,
      }),
      execute: ({ edits, more }) =>
        exclusive(() =>
          attempt(() => {
            workspace.transaction(() => {
              for (const edit of edits) workspace.edit(edit.path, edit.old_text, edit.new_text)
            }, !more)
            return build()
          }),
        ),
    }),
    set_network: tool({
      description: 'Allow the widget to load resources (map tiles) from these hosts. Pass an empty list to block all.',
      inputSchema: z.object({ hosts: z.array(z.enum(NETWORK_HOSTS)) }),
      execute: ({ hosts }) =>
        exclusive(async () => {
          workspace.setNetwork(hosts)
          return { network: workspace.network }
        }),
    }),
  }
}

export type WidgetTools = ReturnType<typeof createTools>

const STAGES: Record<keyof WidgetTools, string> = {
  search_packages: 'Choosing tools',
  add_dependency: 'Choosing tools',
  remove_dependency: 'Choosing tools',
  package_docs: 'Reading up',
  list_files: 'Planning',
  read_file: 'Reviewing',
  write_files: 'Drawing',
  edit_files: 'Refining',
  set_network: 'Preparing map',
}

export function stageFor(toolName: string) {
  return STAGES[toolName as keyof WidgetTools] ?? 'Working'
}
