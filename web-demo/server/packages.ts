import semver from 'semver'
import { config } from './config.js'

const REGISTRY = 'https://registry.npmjs.org'
const DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week'
const PACKUMENT_TTL_MS = 10 * 60_000
const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export class PackageError extends Error {}

interface VersionManifest {
  version: string
  deprecated?: string
  os?: string[]
  cpu?: string[]
  hasInstallScript?: boolean
  dist?: { unpackedSize?: number }
}

interface Packument {
  name: string
  'dist-tags': Record<string, string>
  versions: Record<string, VersionManifest>
}

export interface PackageSummary {
  name: string
  version: string
  description: string
  weeklyDownloads: number | null
}

export interface ResolvedPackage {
  name: string
  version: string
  notes: string[]
}

export function isPackageName(name: string) {
  return name.length <= 214 && NAME.test(name)
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new PackageError(`npm registry responded ${response.status}`)
  return (await response.json()) as T
}

export class PackageRegistry {
  private readonly packuments = new Map<string, { at: number; value: Promise<Packument | null> }>()

  async search(query: string): Promise<PackageSummary[]> {
    const result = await getJson<{
      objects: Array<{
        package: { name: string; version: string; description?: string }
        downloads?: { weekly?: number }
      }>
    }>(`${REGISTRY}/-/v1/search?size=8&text=${encodeURIComponent(query)}`)
    return Promise.all(
      (result?.objects ?? []).map(async ({ package: pkg, downloads }) => ({
        name: pkg.name,
        version: pkg.version,
        description: (pkg.description ?? '').slice(0, 200),
        weeklyDownloads: downloads?.weekly ?? (await this.weeklyDownloads(pkg.name).catch(() => null)),
      })),
    )
  }

  async resolve(name: string, range = 'latest'): Promise<ResolvedPackage> {
    if (!isPackageName(name)) throw new PackageError(`"${name}" is not a valid npm package name`)
    const packument = await this.packument(name)
    if (!packument) throw new PackageError(`Package "${name}" does not exist on npm`)

    const version =
      packument['dist-tags'][range] ??
      semver.maxSatisfying(Object.keys(packument.versions), range === '' ? '*' : range)
    const manifest = version ? packument.versions[version] : undefined
    if (!version || !manifest) throw new PackageError(`No version of "${name}" matches "${range}"`)
    if (manifest.deprecated) throw new PackageError(`${name}@${version} is deprecated: ${manifest.deprecated}`)
    if (manifest.os?.length || manifest.cpu?.length) {
      throw new PackageError(`${name} is platform-specific native code and cannot run in a browser widget`)
    }
    if ((manifest.dist?.unpackedSize ?? 0) > config.maxPackageUnpackedBytes) {
      throw new PackageError(`${name}@${version} is too large to install`)
    }
    const downloads = await this.weeklyDownloads(name)
    if (downloads < config.minWeeklyDownloads) {
      throw new PackageError(
        `${name} has only ${downloads} weekly downloads; pick a widely used package (possible typo?)`,
      )
    }

    const notes: string[] = []
    if (manifest.hasInstallScript) notes.push('Install scripts are skipped; native or postinstall-built parts are unavailable.')
    return { name, version, notes }
  }

  private packument(name: string): Promise<Packument | null> {
    const cached = this.packuments.get(name)
    if (cached && Date.now() - cached.at < PACKUMENT_TTL_MS) return cached.value
    const value = getJson<Packument>(`${REGISTRY}/${name.replace('/', '%2F')}`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
    })
    value.catch(() => this.packuments.delete(name))
    this.packuments.set(name, { at: Date.now(), value })
    return value
  }

  private async weeklyDownloads(name: string): Promise<number> {
    const result = await getJson<{ downloads: number }>(`${DOWNLOADS}/${name}`)
    return result?.downloads ?? 0
  }
}
