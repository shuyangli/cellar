// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { InventoryDelta } from './history'
import type { HistoryInventoryEvent } from '#/lib/cellar'

afterEach(cleanup)

function event(delta: number): HistoryInventoryEvent {
  return {
    id: 1,
    wine_id: 2,
    delta,
    event_type: delta > 0 ? 'purchase' : 'consume',
    reason: null,
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
