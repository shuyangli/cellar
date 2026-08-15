// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { WishlistCard } from './wishlist'
import type { WishlistEntry } from '#/lib/cellar'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ invalidate: vi.fn() }),
}))

afterEach(cleanup)

const entry: WishlistEntry = {
  id: 4,
  wine_id: 138,
  recommended_by: 'Alexander',
  reason: 'A Napa Valley Cabernet Sauvignon to hunt down.',
  shop_name: 'Wine-Searcher',
  listed_price: 73,
  created_at: '2026-08-15 22:52:24',
  producer: "Stag's Leap Wine Cellars",
  wine_name: 'Artemis',
  vintage: '2022',
  wine_type: 'red',
  region: 'California',
  country: 'United States',
  quantity: 0,
}

describe('WishlistCard', () => {
  it('shows an accessible wine-type icon alongside the wishlist details', () => {
    render(<WishlistCard entry={entry} />)

    expect(screen.getByRole('img', { name: 'Red wine' })).toBeTruthy()
    expect(
      screen.getByText("Stag's Leap Wine Cellars Artemis 2022"),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })
})
