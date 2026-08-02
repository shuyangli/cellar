import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useEffect } from 'react'

import appCss from '../styles.css?url'
import { CellarNavigation } from '../components/cellar-navigation'
import { installResumeRefresh } from '../lib/resume-refresh'

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
        <CellarNavigation />
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
