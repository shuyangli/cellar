import { Link, useRouterState } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { CELLAR_BASE_PATH, cellarPath } from '#/lib/base-path'

const NAV_LINKS = [
  { to: '/', label: 'Cellar' },
  { to: '/drink-now/', label: 'Drink now' },
  { to: '/history/', label: 'History' },
  { to: '/ordered/', label: 'Ordered' },
  { to: '/wishlist/', label: 'Wishlist' },
  { to: '/stats/', label: 'Stats' },
] as const

const NAV_LINK_CLASS =
  'rounded-full px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground'
const ACTIVE_NAV_LINK_CLASS =
  'rounded-full px-3 py-1.5 text-sm whitespace-nowrap bg-secondary font-medium text-foreground shadow-[inset_0_0_0_1px_rgb(99_50_60/0.07)]'

const subscribeToHydration = () => () => undefined
const hydratedSnapshot = () => true
const serverSnapshot = () => false

function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  )
}

function normalizeRoutePath(path: string, basePath: string) {
  const pathname = path.split(/[?#]/, 1)[0] || '/'
  const normalizedBase =
    basePath === '/' ? '' : basePath.replace(/^\/+|\/+$/g, '')
  const basePrefix = normalizedBase ? `/${normalizedBase}` : ''
  const withoutBase =
    basePrefix &&
    (pathname === basePrefix || pathname.startsWith(`${basePrefix}/`))
      ? pathname.slice(basePrefix.length) || '/'
      : pathname
  const withLeadingSlash = withoutBase.startsWith('/')
    ? withoutBase
    : `/${withoutBase}`
  return withLeadingSlash === '/' ? '/' : withLeadingSlash.replace(/\/+$/, '')
}

export function isNavLinkActive(
  currentPath: string,
  targetPath: string,
  basePath = CELLAR_BASE_PATH,
) {
  const current = normalizeRoutePath(currentPath, basePath)
  const target = normalizeRoutePath(targetPath, '')
  return target === '/'
    ? current === '/'
    : current === target || current.startsWith(`${target}/`)
}

export function CellarNavigation() {
  const hydrated = useHydrated()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2.5 sm:px-6">
      <span className="font-heading mr-4 hidden items-center gap-2 text-lg font-semibold tracking-[0.01em] sm:flex">
        <span className="flex size-7 items-center justify-center rounded-full bg-[linear-gradient(145deg,#814559,#552534)] text-[13px] text-primary-foreground shadow-[0_4px_13px_rgb(108_48_64/0.24),inset_0_1px_rgb(255_255_255/0.24)]">
          C
        </span>
        Cellar
      </span>
      {NAV_LINKS.map((link) => {
        const active = isNavLinkActive(currentPath, link.to)
        return hydrated ? (
          <Link
            key={link.to}
            to={link.to}
            className={active ? ACTIVE_NAV_LINK_CLASS : NAV_LINK_CLASS}
            aria-current={active ? 'page' : undefined}
            activeProps={{ className: '' }}
            activeOptions={{ exact: link.to === '/' }}
          >
            {link.label}
          </Link>
        ) : (
          <a
            key={link.to}
            href={cellarPath(link.to)}
            className={NAV_LINK_CLASS}
          >
            {link.label}
          </a>
        )
      })}
    </nav>
  )
}
