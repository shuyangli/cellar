// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { HistoryRow, InventoryDelta } from './history'
import type { HistoryEntry, HistoryInventoryEvent, Tasting } from '#/lib/cellar'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ invalidate: vi.fn() }),
}))

afterEach(cleanup)

function event(delta: number): HistoryInventoryEvent {
  return {
    id: 1,
    wine_id: 2,
    delta,
    event_type: delta > 0 ? 'purchase' : 'consume',
    reason: 'Dinner with friends',
    occurred_at: '2026-08-10 12:00:00',
    purchase_quantity: null,
    purchase_price_per_bottle: null,
    purchase_currency: null,
    purchase_vendor: null,
    purchase_date: null,
    purchase_id: null,
    tasting_id: null,
  }
}

const review: Tasting = {
  id: 7,
  wine_id: 2,
  user_id: 1,
  user_name: 'Shuyang',
  user_initials: 'S',
  context_type: 'home',
  venue: null,
  price_paid: null,
  rating: 92,
  liked: 1,
  buy_again: 1,
  tasting_notes: 'Silky and savory.',
  food_pairing: 'roast chicken',
  tasted_on: '2026-08-10',
  created_at: '2026-08-10 12:30:00',
  inventory_event_id: 1,
}

const entry: HistoryEntry = {
  key: 'event:1',
  kind: 'inventory_change',
  sort_at: '2026-08-10 12:00:00',
  wine_id: 2,
  producer: 'Domaine Example',
  wine_name: 'Vieilles Vignes',
  vintage: '2020',
  wine_type: 'red',
  region: 'Burgundy',
  country: 'France',
  event: event(-1),
  reviews: [review],
}

describe('InventoryDelta', () => {
  it('shows additions in green in light and dark themes', () => {
    render(<InventoryDelta event={event(1)} />)
    const classes = screen.getByText('+1').className
    for (const expected of [
      'border-emerald-200',
      'bg-emerald-50',
      'text-emerald-700',
      'dark:border-emerald-900',
      'dark:bg-emerald-950/50',
      'dark:text-emerald-300',
    ]) {
      expect(classes).toContain(expected)
    }
  })

  it('shows removals in red in light and dark themes', () => {
    render(<InventoryDelta event={event(-1)} />)
    const classes = screen.getByText('-1').className
    for (const expected of [
      'border-red-200',
      'bg-red-50',
      'text-red-700',
      'dark:border-red-900',
      'dark:bg-red-950/50',
      'dark:text-red-300',
    ]) {
      expect(classes).toContain(expected)
    }
  })
})

describe('HistoryRow', () => {
  it('keeps a compact summary visible and reveals details inline', () => {
    render(<HistoryRow entry={entry} />)

    expect(
      screen.getByText('Domaine Example Vieilles Vignes 2020'),
    ).toBeTruthy()
    expect(screen.getAllByText('Drank 1 bottle').length).toBeGreaterThan(0)
    expect(screen.getAllByText('92').length).toBeGreaterThan(0)

    const toggle = screen.getByRole('button', {
      name: 'Expand history entry for Domaine Example Vieilles Vignes 2020',
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const detailsId = toggle.getAttribute('aria-controls')
    expect(detailsId).toBeTruthy()
    expect(document.getElementById(detailsId!)?.hasAttribute('hidden')).toBe(
      true,
    )

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Dinner with friends')).toBeTruthy()
    expect(screen.getByText('Silky and savory.')).toBeTruthy()
    expect(document.getElementById(detailsId!)?.hasAttribute('hidden')).toBe(
      false,
    )
  })

  it('preserves an in-progress review draft while the row is collapsed', () => {
    render(<HistoryRow entry={entry} />)

    const toggle = screen.getByRole('button', { name: /Expand history entry/ })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Add another review' }))

    const rating = screen.getByLabelText<HTMLInputElement>('Rating (0–100)')
    fireEvent.change(rating, { target: { value: '94' } })
    expect(rating.value).toBe('94')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)

    expect(
      screen.getByLabelText<HTMLInputElement>('Rating (0–100)').value,
    ).toBe('94')
  })

  it('uses a mobile-safe grid and a 44px expansion target', () => {
    render(<HistoryRow entry={entry} />)

    const row = screen.getByRole('article', {
      name: 'Domaine Example Vieilles Vignes 2020 history entry',
    })
    expect(row.className).toContain('overflow-hidden')
    expect(row.firstElementChild?.className).toContain('min-w-0')
    expect(
      screen.getByRole('button', { name: /Expand history entry/ }).className,
    ).toContain('size-11')
  })
})
