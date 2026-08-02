import { Link } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { cellarPath } from '#/lib/base-path'

const NAV_LINKS = [
  { to: '/', label: 'Cellar' },
  { to: '/drink-now/', label: 'Drink now' },
  { to: '/history/', label: 'History' },
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

export function CellarNavigation() {
  const hydrated = useHydrated()

  return (
    <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2.5 sm:px-6">
      <span className="font-heading mr-4 hidden items-center gap-2 text-lg font-semibold tracking-[0.01em] sm:flex">
        <span className="flex size-7 items-center justify-center rounded-full bg-[linear-gradient(145deg,#814559,#552534)] text-[13px] text-primary-foreground shadow-[0_4px_13px_rgb(108_48_64/0.24),inset_0_1px_rgb(255_255_255/0.24)]">
          C
        </span>
        Cellar
      </span>
      {NAV_LINKS.map((link) =>
        hydrated ? (
          <Link
            key={link.to}
            to={link.to}
            className={NAV_LINK_CLASS}
            activeProps={{ className: ACTIVE_NAV_LINK_CLASS }}
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
        ),
      )}
    </nav>
  )
}
