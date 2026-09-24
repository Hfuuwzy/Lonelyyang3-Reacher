export const DEFAULT_LOCALE = 'zh'
export const JA_PREFIX = '/ja'

export function canonicalContentPathFromRoute(routePath: string): string {
  const canonicalPath = routePath.replace(/^\/ja(?=\/|$)/, '')
  return canonicalPath === '' ? '/' : canonicalPath
}

export function slugFromBlogPath(path: string): string {
  const segments = canonicalContentPathFromRoute(path).split('/').filter(Boolean)
  return segments.at(-1) ?? ''
}

export function localizedPathFromCanonical(canonicalPath: string, localePath: (path: string) => string): string {
  return localePath(canonicalPath)
}
