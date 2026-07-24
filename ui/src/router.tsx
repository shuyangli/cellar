import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { CELLAR_BASE_PATH } from './lib/base-path'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    basepath: CELLAR_BASE_PATH || undefined,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
