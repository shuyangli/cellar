// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { CellarNavigation, isNavLinkActive } from './cellar-navigation'

afterEach(cleanup)

function createTestRouter(initialPath = '/', basepath?: string) {
  const rootRoute = createRootRoute({
    component: CellarNavigation,
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  })
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/history/',
    component: () => null,
  })
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stats/',
    component: () => null,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, historyRoute, statsRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    basepath,
    trailingSlash: 'always',
  })
}

describe('CellarNavigation', () => {
  it('matches the root page with or without the deployment base path', () => {
    expect(isNavLinkActive('/', '/', '')).toBe(true)
    expect(isNavLinkActive('/cellar/', '/', '/cellar')).toBe(true)
    expect(isNavLinkActive('/cellar/stats/', '/', '/cellar')).toBe(false)
  })

  it('renders a neutral server shell instead of baking in the prerender route', async () => {
    const router = createTestRouter('/history/')
    await router.load()

    const html = renderToString(<RouterProvider router={router} />)

    expect(html).not.toContain('aria-current="page"')
    expect(html).not.toContain('data-status="active"')
  })

  it('shows only the current page after hydration and navigation', async () => {
    const router = createTestRouter('/')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() =>
      expect(
        screen
          .getByRole('link', { name: 'Cellar' })
          .getAttribute('aria-current'),
      ).toBe('page'),
    )
    expect(
      screen
        .getByRole('link', { name: 'History' })
        .getAttribute('aria-current'),
    ).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Stats' }))

    await waitFor(() =>
      expect(
        screen
          .getByRole('link', { name: 'Stats' })
          .getAttribute('aria-current'),
      ).toBe('page'),
    )
    expect(
      screen.getByRole('link', { name: 'Cellar' }).getAttribute('aria-current'),
    ).toBeNull()
    expect(
      screen
        .getByRole('link', { name: 'History' })
        .getAttribute('aria-current'),
    ).toBeNull()
  })

  it('marks the cellar root active when the app has a base path', async () => {
    const router = createTestRouter('/cellar/', '/cellar')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() =>
      expect(
        screen
          .getByRole('link', { name: 'Cellar' })
          .getAttribute('aria-current'),
      ).toBe('page'),
    )
    expect(
      screen
        .getByRole('link', { name: 'History' })
        .getAttribute('aria-current'),
    ).toBeNull()
  })
})
