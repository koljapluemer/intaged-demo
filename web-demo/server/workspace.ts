import type { NetworkHost, WidgetSource } from '../src/types.js'
import type { BuildResult } from './bundler.js'

const FILE_NAME = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(ts|js|css|html|json)$/
const MAX_FILES = 20
const MAX_FILE_BYTES = 150_000

export class WorkspaceError extends Error {}

const STARTER: WidgetSource = {
  files: {
    'body.html': '<div id="app"></div>\n',
    'style.css': '#app {\n  font-family: var(--wk-font);\n  color: var(--wk-fg);\n}\n',
    'main.ts': "const app = document.getElementById('app')!\napp.textContent = 'TODO'\n",
  },
  deps: {},
  network: [],
}

/** Mutable widget source an agent edits during one generation. */
export class Workspace {
  files: Record<string, string>
  deps: Record<string, string>
  network: NetworkHost[]
  private revision = 0
  private lastBuild: { revision: number; result: BuildResult } | null = null
  finished = false

  constructor(seed: WidgetSource = STARTER) {
    this.files = { ...seed.files }
    this.deps = { ...seed.deps }
    this.network = [...seed.network]
  }

  get source(): WidgetSource {
    return { files: { ...this.files }, deps: { ...this.deps }, network: [...this.network] }
  }

  /** The bundle hash of the latest successful build, if it still matches the current source. */
  get currentBundle(): string | null {
    const build = this.lastBuild
    return build && build.revision === this.revision && build.result.ok ? build.result.hash : null
  }

  get lastDiagnostics(): string[] {
    const result = this.lastBuild?.result
    return result && 'diagnostics' in result ? result.diagnostics : []
  }

  read(name: string) {
    const contents = this.files[name]
    if (contents === undefined) throw new WorkspaceError(`No file named ${name}. Files: ${this.list().join(', ')}`)
    return contents
  }

  list() {
    return Object.keys(this.files).sort()
  }

  write(name: string, contents: string) {
    if (!FILE_NAME.test(name)) throw new WorkspaceError(`Invalid file name "${name}": use a flat name ending in .ts, .js, .css, .html or .json`)
    if (name.startsWith('__')) throw new WorkspaceError('File names starting with __ are reserved')
    if (!(name in this.files) && Object.keys(this.files).length >= MAX_FILES) throw new WorkspaceError('Too many files')
    if (Buffer.byteLength(contents) > MAX_FILE_BYTES) throw new WorkspaceError(`${name} exceeds ${MAX_FILE_BYTES} bytes`)
    this.files[name] = contents
    this.touch()
  }

  edit(name: string, oldText: string, newText: string) {
    const contents = this.read(name)
    const first = contents.indexOf(oldText)
    if (!oldText || first === -1) throw new WorkspaceError(`The text to replace was not found in ${name}`)
    if (contents.indexOf(oldText, first + 1) !== -1) {
      throw new WorkspaceError(`The text to replace occurs more than once in ${name}; include more context`)
    }
    this.write(name, contents.slice(0, first) + newText + contents.slice(first + oldText.length))
  }

  delete(name: string) {
    this.read(name)
    if (name === 'main.ts' || name === 'body.html') throw new WorkspaceError(`${name} is required`)
    delete this.files[name]
    this.touch()
  }

  setDependency(name: string, version: string | null) {
    if (version === null) delete this.deps[name]
    else this.deps[name] = version
    this.touch()
  }

  setNetwork(hosts: NetworkHost[]) {
    this.network = [...new Set(hosts)]
    this.touch()
  }

  recordBuild(result: BuildResult) {
    this.lastBuild = { revision: this.revision, result }
  }

  finish() {
    if (!this.currentBundle) {
      throw new WorkspaceError('Run build after your last change and fix all errors before finishing')
    }
    this.finished = true
  }

  private touch() {
    this.revision++
    this.finished = false
  }
}
