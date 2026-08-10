// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import { InventoryEventReviewForm } from './inventory-event-review-form'

vi.mock('./reviewer-select', () => ({
  ReviewerSelect: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <input
      aria-label="Reviewer"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

afterEach(cleanup)

describe('InventoryEventReviewForm', () => {
  it('defaults to the inventory event date and saves without consuming again', async () => {
    const onSave = vi.fn(async () => {})
    const onSaved = vi.fn()
    render(
      <InventoryEventReviewForm
        eventDate="2026-08-09 15:30:00"
        onSave={onSave}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByLabelText<HTMLInputElement>('Tasted on').value).toBe(
      '2026-08-09',
    )
    fireEvent.change(screen.getByLabelText('Reviewer'), {
      target: { value: 'Alex' },
    })
    fireEvent.change(screen.getByLabelText('Rating (0–100)'), {
      target: { value: '93' },
    })
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: '  silky and long  ' },
    })
    fireEvent.click(screen.getByLabelText('Would buy again'))
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({
      user: 'Alex',
      rating: 93,
      tasting_notes: 'silky and long',
      food_pairing: '',
      context_type: 'home',
      buy_again: true,
      tasted_on: '2026-08-09',
      consume_bottle: false,
    })
  })

  it('rejects an out-of-range rating before writing', async () => {
    const onSave = vi.fn(async () => {})
    render(
      <InventoryEventReviewForm
        eventDate="2026-08-09"
        onSave={onSave}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('Rating (0–100)'), {
      target: { value: '101' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Rating must be between 0 and 100',
    )
    expect(onSave).not.toHaveBeenCalled()
  })
})
