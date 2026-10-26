import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { NETWORK_HOSTS } from '../src/types.js'
import type { Bundler } from './bundler.js'
import { GUIDE_TOPICS, GUIDES } from './guides.js'
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
  if (!(name in workspace.deps)) throw new Error(`Add ${name} with add_dependency before reading its docs`)
  const root = await realpath(path.join(await bundler.ensureInstalled(workspace.deps), name))

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

export function createTools(deps: ToolDeps) {
  const { workspace, registry, bundler } = deps
  return {
    search_packages: tool({
      description: 'Search npm for browser packages. Returns name, latest version, description and weekly downloads.',
      inputSchema: z.object({ query: z.string().min(2).max(100) }),
      execute: ({ query }) => attempt(() => registry.search(query)),
    }),
    add_dependency: tool({
      description:
        'Add an npm package to the workspace (resolves an exact version and installs it). Required before importing it or reading its docs.',
      inputSchema: z.object({
        name: z.string(),
        range: z.string().optional().describe('semver range or dist-tag; defaults to latest'),
      }),
      execute: ({ name, range }) =>
        attempt(async () => {
          const resolved = await registry.resolve(name, range)
          const next = { ...workspace.deps, [resolved.name]: resolved.version }
          await bundler.ensureInstalled(next)
          workspace.setDependency(resolved.name, resolved.version)
          return { added: `${resolved.name}@${resolved.version}`, notes: resolved.notes }
        }),
    }),
    remove_dependency: tool({
      description: 'Remove an npm package from the workspace.',
      inputSchema: z.object({ name: z.string() }),
      execute: ({ name }) =>
        attempt(() => {
          workspace.setDependency(name, null)
          return `Removed ${name}`
        }),
    }),
    package_docs: tool({
      description:
        'Read an added package: its file list, type declarations and README. Pass path to read a specific file inside the package, e.g. a .d.ts file.',
      inputSchema: z.object({ name: z.string(), path: z.string().optional() }),
      execute: ({ name, path: file }) => attempt(() => packageDocs(deps, name, file)),
    }),
    read_guide: tool({
      description: 'Read a short guide about this runtime: sandbox, design (theme variables, rules), charts, maps, 3d.',
      inputSchema: z.object({ topic: z.enum(GUIDE_TOPICS) }),
      execute: ({ topic }) => GUIDES[topic],
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
    write_file: tool({
      description: 'Create or replace a workspace file with the full contents.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: ({ path: name, content }) =>
        attempt(() => {
          workspace.write(name, content)
          return `Wrote ${name}`
        }),
    }),
    edit_file: tool({
      description: 'Replace one exact, unique occurrence of old_text with new_text in a workspace file.',
      inputSchema: z.object({ path: z.string(), old_text: z.string(), new_text: z.string() }),
      execute: ({ path: name, old_text, new_text }) =>
        attempt(() => {
          workspace.edit(name, old_text, new_text)
          return `Edited ${name}`
        }),
    }),
    delete_file: tool({
      description: 'Delete a workspace file.',
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path: name }) =>
        attempt(() => {
          workspace.delete(name)
          return `Deleted ${name}`
        }),
    }),
    set_network: tool({
      description: 'Allow the widget to load resources (map tiles) from these hosts. Pass an empty list to block all.',
      inputSchema: z.object({ hosts: z.array(z.enum(NETWORK_HOSTS)) }),
      execute: ({ hosts }) => {
        workspace.setNetwork(hosts)
        return { network: workspace.network }
      },
    }),
    build: tool({
      description: 'Bundle the workspace. Returns errors with file:line:column, or the bundle size on success.',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await bundler.build(workspace.source)
        workspace.recordBuild(result)
        return result.ok ? { ok: true, bytes: result.bytes, warnings: result.warnings } : result
      },
    }),
    finish: tool({
      description: 'Finish once the latest build succeeded. Summarize the widget in one sentence.',
      inputSchema: z.object({ summary: z.string().max(500) }),
      execute: () =>
        attempt(() => {
          workspace.finish()
          return 'Done'
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
  read_guide: 'Planning',
  list_files: 'Planning',
  read_file: 'Reviewing',
  write_file: 'Drawing',
  edit_file: 'Refining',
  delete_file: 'Refining',
  set_network: 'Preparing map',
  build: 'Checking',
  finish: 'Finishing touches',
}

export function stageFor(toolName: string) {
  return STAGES[toolName as keyof WidgetTools] ?? 'Working'
}
