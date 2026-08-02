import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useEffect } from 'react'

import appCss from '../styles.css?url'
import { installResumeRefresh } from '../lib/resume-refresh'

const NAV_LINKS = [
  { to: '/', label: 'Cellar' },
  { to: '/drink-now/', label: 'Drink now' },
  { to: '/history/', label: 'History' },
  { to: '/wishlist/', label: 'Wishlist' },
  { to: '/stats/', label: 'Stats' },
] as const

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Wine Cellar',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootLayout() {
  const router = useRouter()

  useEffect(() => installResumeRefresh(() => router.invalidate()), [router])

  return (
    <div className="relative isolate min-h-screen text-foreground">
      <div className="cellar-atmosphere" aria-hidden="true">
        <span className="cellar-bubble" />
        <span className="cellar-bubble" />
        <span className="cellar-bubble" />
        <span className="cellar-bubble" />
      </div>
      <header className="sticky top-0 z-10 border-b border-white/45 bg-[linear-gradient(100deg,rgb(253_249_241/0.9),rgb(247_238_230/0.84),rgb(246_234_235/0.86))] shadow-[0_1px_18px_rgb(67_53_38/0.055)] backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2.5 sm:px-6">
          <span className="font-heading mr-4 hidden items-center gap-2 text-lg font-semibold tracking-[0.01em] sm:flex">
            <span className="flex size-7 items-center justify-center rounded-full bg-[linear-gradient(145deg,#814559,#552534)] text-[13px] text-primary-foreground shadow-[0_4px_13px_rgb(108_48_64/0.24),inset_0_1px_rgb(255_255_255/0.24)]">
              C
            </span>
            Cellar
          </span>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-full px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              activeProps={{
                className:
                  'rounded-full px-3 py-1.5 text-sm whitespace-nowrap bg-secondary font-medium text-foreground shadow-[inset_0_0_0_1px_rgb(99_50_60/0.07)]',
              }}
              activeOptions={{ exact: link.to === '/' }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
