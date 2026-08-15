// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OrderedWineCard, OrderedWineRow } from './ordered-wine-row'
import type { OrderedWine } from '#/lib/cellar'

const order: OrderedWine = {
  id: 8,
  wine_id: 101,
  quantity: 4,
  price_per_bottle: 52.5,
  currency: 'USD',
  vendor: 'Crush Wine & Spirits',
  order_reference: 'CW-123',
  ordered_on: '2026-08-01',
  tracking_url: 'https://www.ups.com/track?tracknum=1Z999',
  expected_on: '2026-08-07',
  status: 'ordered',
  arrived_on: null,
  purchase_id: null,
  source_message_id: 'gmail-1',
  notes: null,
  created_at: '2026-08-01 12:00:00',
  updated_at: '2026-08-01 12:00:00',
  producer: 'Camille Jacquet',
  wine_name: 'Le Mesnil-sur-Oger Brut Grand Cru',
  vintage: 'NV',
  wine_type: 'sparkling',
  region: 'Champagne',
  country: 'France',
  bottle_size_ml: 750,
}

afterEach(cleanup)

describe('OrderedWineRow', () => {
  it('shows shipment details with a safe tracking link', () => {
    render(
      <table>
        <tbody>
          <OrderedWineRow order={order} onArrive={() => undefined} />
        </tbody>
      </table>,
    )

    expect(screen.getByRole('img', { name: 'Sparkling wine' })).toBeTruthy()
    expect(screen.getByText('Camille Jacquet')).toBeTruthy()
    expect(screen.getByText('4 × 750 mL')).toBeTruthy()
    expect(screen.getByText('Expected Aug 7')).toBeTruthy()
    const tracking = screen.getByRole('link', { name: 'Track shipment' })
    expect(tracking.getAttribute('href')).toBe(order.tracking_url)
    expect(tracking.getAttribute('target')).toBe('_blank')
    expect(tracking.getAttribute('rel')).toContain('noopener')
  })

  it('marks the exact order as arrived and disables retries while pending', () => {
    const onArrive = vi.fn()
    const { rerender } = render(
      <table>
        <tbody>
          <OrderedWineRow order={order} onArrive={onArrive} />
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Arrived' }))
    expect(onArrive).toHaveBeenCalledWith(order)

    rerender(
      <table>
        <tbody>
          <OrderedWineRow order={order} onArrive={onArrive} pending />
        </tbody>
      </table>,
    )
    expect(
      screen
        .getByRole('button', { name: 'Arriving…' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('falls back gracefully for unexpected currency metadata', () => {
    render(
      <table>
        <tbody>
          <OrderedWineRow
            order={{ ...order, currency: 'NOT-A-CURRENCY' }}
            onArrive={() => undefined}
          />
        </tbody>
      </table>,
    )

    expect(screen.getByText('52.50 NOT-A-CURRENCY each')).toBeTruthy()
  })
})

describe('OrderedWineCard', () => {
  it('presents the complete order as a narrow mobile card', () => {
    render(<OrderedWineCard order={order} onArrive={() => undefined} />)

    const card = screen.getByRole('article', {
      name: 'Camille Jacquet Le Mesnil-sur-Oger Brut Grand Cru',
    })
    expect(card.className).toContain('md:hidden')
    expect(screen.getByRole('img', { name: 'Sparkling wine' })).toBeTruthy()
    expect(screen.getByText('4 × 750 mL')).toBeTruthy()
    expect(screen.getByText('Crush Wine & Spirits')).toBeTruthy()
    expect(screen.getByText('#CW-123')).toBeTruthy()
    expect(screen.getByText('Ordered Aug 1')).toBeTruthy()
    expect(screen.getByText('Expected Aug 7')).toBeTruthy()
    expect(screen.getByText('$52.50 each')).toBeTruthy()

    const tracking = screen.getByRole('link', { name: 'Track shipment' })
    expect(tracking.getAttribute('href')).toBe(order.tracking_url)
    expect(tracking.getAttribute('target')).toBe('_blank')
    expect(tracking.className).toContain('min-h-11')
  })

  it('uses the shared arrival action and exposes errors as status text', () => {
    const onArrive = vi.fn()
    const { rerender } = render(
      <OrderedWineCard order={order} onArrive={onArrive} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark arrived' }))
    expect(onArrive).toHaveBeenCalledWith(order)

    rerender(
      <OrderedWineCard
        order={order}
        onArrive={onArrive}
        pending
        error="Inventory updated; reload the page."
      />,
    )

    const button = screen.getByRole('button', { name: 'Arriving…' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.className).toContain('min-h-11')
    expect(screen.getByRole('status').textContent).toContain('reload the page')

    fireEvent.click(button)
    expect(onArrive).toHaveBeenCalledTimes(1)
  })
})
