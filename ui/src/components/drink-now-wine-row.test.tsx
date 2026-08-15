// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { DrinkNowWineRow } from './drink-now-wine-row'
import type { CellarItem } from '#/lib/cellar'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

afterEach(cleanup)

const wine = {
  id: 1,
  producer: 'Gump Hof',
  wine_name: 'Mediaevum Weissburgunder',
  vintage: '2024',
  wine_type: 'white',
  region: 'Trentino-Alto Adige',
  quantity: 2,
  drinking_window_start: '2026',
  drinking_window_end: '2029',
} as CellarItem

describe('DrinkNowWineRow', () => {
  it('lays out bottle count before wine details and a single-line window', () => {
    render(<DrinkNowWineRow item={wine} year={2026} />)

    const row = screen.getByTestId('drink-now-wine-row')
    expect(screen.getByRole('img', { name: 'White wine' })).toBeTruthy()
    expect(row.children[0].getAttribute('data-wine-type')).toBe('white')
    expect(
      Array.from(row.children)
        .slice(1)
        .map((child) => child.getAttribute('data-slot')),
    ).toEqual(['bottle-count', 'wine-details', 'drinking-window'])
    expect(screen.getByLabelText('2 bottles').textContent).toBe('×2')
    expect(screen.getByText('2026').parentElement?.className).toContain(
      'whitespace-nowrap',
    )
  })
})
