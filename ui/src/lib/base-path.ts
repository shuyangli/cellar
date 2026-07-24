declare global {
  interface Window {
    __CELLAR_BASE_PATH__?: string
  }
}

export function normalizeCellarBasePath(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!value || value === '/') return ''
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.replace(/\/+$/, '')
}

export function readCellarBasePath(): string {
  if (typeof window === 'undefined') return ''
  return normalizeCellarBasePath(window.__CELLAR_BASE_PATH__)
}

export function cellarPath(
  path: string,
  basePath = readCellarBasePath(),
): string {
  if (!path.startsWith('/')) {
    throw new Error(`Cellar path must be root-relative: ${path}`)
  }
  return `${basePath}${path}`
}

export const CELLAR_BASE_PATH = readCellarBasePath()
