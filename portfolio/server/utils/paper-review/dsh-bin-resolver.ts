import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Expected failures resolving the checked-in local Harness CLI. */
export type DshBinResolutionErrorCode = 'cli-not-found' | 'version-mismatch' | 'cli-not-built'

export interface DshBinResolutionSuccess {
  readonly ok: true
  /** Absolute path to the built local CLI entry. */
  readonly dshBin: string
}

export interface DshBinResolutionFailure {
  readonly ok: false
  readonly error: { readonly code: DshBinResolutionErrorCode; readonly message: string }
}

export type DshBinResolution = DshBinResolutionSuccess | DshBinResolutionFailure

/**
 * Resolve the checked-in `harness/` fork CLI to an absolute built bin.
 * @param appRoot - the Nuxt app root (`portfolio/`), where npm commands run.
 */
export interface DshBinResolver {
  (appRoot: string): DshBinResolution
}

/**
 * Whether an error is an expected manifest parse/read failure: JSON syntax or
 * a Node filesystem read error. Unrelated errors are rethrown, not swallowed.
 */
function isExpectedManifestReadError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true
  }
  if (!(error instanceof Error)) {
    return false
  }
  return 'code' in error && 'errno' in error && typeof error.code === 'string'
}

/** The package-manifest fields the resolver reads, narrowed from raw JSON. */
interface PackageManifest {
  readonly version: string
  readonly bin?: { readonly dsh?: unknown } | string
}

/**
 * Narrow raw manifest JSON into a typed value at the file boundary. Requires a
 * non-empty string version; malformed `bin` is captured for later validation.
 */
function parsePackageManifest(raw: unknown): PackageManifest | undefined {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) {
    return undefined
  }
  const version = raw.version
  if (typeof version !== 'string' || version === '') {
    return undefined
  }
  if (!('bin' in raw)) {
    return { version }
  }
  const bin = raw.bin
  if (typeof bin === 'string') {
    return { version, bin }
  }
  if (typeof bin === 'object' && bin !== null && 'dsh' in bin) {
    return { version, bin: { dsh: bin.dsh } }
  }
  return { version }
}

/**
 * Resolve the checked-in `harness/` CLI manifest to an absolute built bin.
 * Compares the fork CLI version against the app-installed SDK version and
 * requires the built entry to exist; there is no npm-runtime fallback.
 * @param sdkManifestPath - the installed SDK client `package.json`.
 * @param cliManifestPath - the fork `harness/apps/cli/package.json`.
 */
export function resolveLocalDshBin(sdkManifestPath: string, cliManifestPath: string): DshBinResolution {
  if (!existsSync(sdkManifestPath)) {
    return {
      ok: false,
      error: { code: 'cli-not-found', message: 'The app-installed Harness SDK manifest is missing; reinstall npm dependencies.' },
    }
  }
  if (!existsSync(cliManifestPath)) {
    return {
      ok: false,
      error: { code: 'cli-not-found', message: 'The Harness CLI fork source is missing; ensure the harness/ tree is present.' },
    }
  }
  let sdkManifestRaw: unknown
  let cliManifestRaw: unknown
  try {
    sdkManifestRaw = JSON.parse(readFileSync(sdkManifestPath, 'utf8'))
    cliManifestRaw = JSON.parse(readFileSync(cliManifestPath, 'utf8'))
  } catch (error) {
    if (!isExpectedManifestReadError(error)) {
      throw error
    }
    return { ok: false, error: { code: 'cli-not-found', message: 'A Harness package manifest is unreadable.' } }
  }
  const sdkManifest = parsePackageManifest(sdkManifestRaw)
  const cliManifest = parsePackageManifest(cliManifestRaw)
  if (sdkManifest === undefined || cliManifest === undefined) {
    return {
      ok: false,
      error: { code: 'version-mismatch', message: 'A Harness package manifest declares no usable version; rebuild the fork in harness/.' },
    }
  }
  if (sdkManifest.version !== cliManifest.version) {
    return {
      ok: false,
      error: { code: 'version-mismatch', message: 'The local Harness CLI version differs from the app-installed SDK; rebuild the fork in harness/.' },
    }
  }
  const bin = typeof cliManifest.bin === 'object' && cliManifest.bin !== null ? cliManifest.bin.dsh : cliManifest.bin
  if (typeof bin !== 'string' || bin === '') {
    return { ok: false, error: { code: 'cli-not-built', message: 'The Harness CLI fork declares no dsh executable.' } }
  }
  const dshBin = resolve(dirname(cliManifestPath), bin)
  if (!existsSync(dshBin)) {
    return { ok: false, error: { code: 'cli-not-built', message: 'The Harness CLI is not built; build the fork in harness/ before the paper-review workbench.' } }
  }
  return { ok: true, dshBin }
}

/** Relative fork/sdk manifest layout from the Nuxt app root (`portfolio/`). */
const LOCAL_SDK_MANIFEST = join('node_modules', '@deepseek-ai', 'dsh-sdk-client', 'package.json')
const LOCAL_CLI_MANIFEST = join('..', 'harness', 'apps', 'cli', 'package.json')

/** Production resolver using the known repo layout from the Nuxt app root. */
export const defaultResolveLocalDshBin: DshBinResolver = (appRoot) =>
  resolveLocalDshBin(join(appRoot, LOCAL_SDK_MANIFEST), join(appRoot, LOCAL_CLI_MANIFEST))
