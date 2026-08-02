// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import { TastingEditor } from './tasting-editor'
import type { Tasting, TastingUpdate } from '#/lib/cellar'

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

const tasting: Tasting = {
  id: 17,
  wine_id: 4,
  user_id: 1,
  user_name: 'Shuyang',
  user_initials: 'S',
  context_type: 'home',
  venue: null,
  price_paid: null,
  rating: 89,
  liked: 1,
  buy_again: 0,
  tasting_notes: 'Tight and mineral',
  food_pairing: null,
  tasted_on: '2026-07-31',
  created_at: '2026-07-31 12:00:00',
}

afterEach(cleanup)

describe('TastingEditor', () => {
  it('prefills every editable part of a review', () => {
    render(
      <TastingEditor
        tasting={tasting}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByLabelText<HTMLInputElement>('Reviewer').value).toBe(
      'Shuyang',
    )
    expect(
      screen.getByLabelText<HTMLInputElement>('Rating (0–100)').value,
    ).toBe('89')
    expect(screen.getByLabelText<HTMLInputElement>('Tasted on').value).toBe(
      '2026-07-31',
    )
    expect(screen.getByLabelText<HTMLTextAreaElement>('Notes').value).toBe(
      'Tight and mineral',
    )
    expect(screen.getByLabelText('Food pairing')).toBeDefined()
    expect(screen.getByLabelText('Venue')).toBeDefined()
    expect(screen.getByLabelText('Price paid')).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>('Liked').checked).toBe(true)
    expect(screen.getByLabelText('Would buy again')).toBeDefined()
  })

  it('saves changed values and can clear optional fields', async () => {
    const onSave = vi.fn(async () => {})
    const onSaved = vi.fn()
    render(
      <TastingEditor
        tasting={tasting}
        onSave={onSave}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('Reviewer'), {
      target: { value: 'Alex' },
    })
    fireEvent.change(screen.getByLabelText('Rating (0–100)'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('Where'), {
      target: { value: 'restaurant' },
    })
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'The Four Horsemen' },
    })
    fireEvent.change(screen.getByLabelText('Price paid'), {
      target: { value: '24.5' },
    })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Food pairing'), {
      target: { value: 'roast chicken' },
    })
    fireEvent.click(screen.getByLabelText('Liked'))
    fireEvent.click(screen.getByLabelText('Would buy again'))
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({
      user: 'Alex',
      rating: null,
      tasting_notes: '',
      food_pairing: 'roast chicken',
      context_type: 'restaurant',
      venue: 'The Four Horsemen',
      price_paid: 24.5,
      liked: false,
      buy_again: true,
      tasted_on: '2026-07-31',
    })
  })

  it('preserves an existing custom tasting context', async () => {
    const onSave = vi.fn(async () => {})
    render(
      <TastingEditor
        tasting={{ ...tasting, context_type: 'friends' }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByLabelText<HTMLSelectElement>('Where').value).toBe(
      'friends',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ context_type: 'friends' }),
    )
  })

  it('does not silently attribute a legacy unassigned review', async () => {
    const onSave = vi.fn(async (_update: TastingUpdate) => {})
    render(
      <TastingEditor
        tasting={{ ...tasting, user_id: null, user_name: null }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('user')
  })

  it('keeps the editor open and shows the mutation error when saving fails', async () => {
    const onSaved = vi.fn()
    render(
      <TastingEditor
        tasting={tasting}
        onSave={async () => {
          throw new Error('review update failed')
        }}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'review update failed',
    )
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save review' })).toBeDefined()
  })

  it('validates rating and price before sending a write', async () => {
    const onSave = vi.fn(async () => {})
    render(
      <TastingEditor tasting={tasting} onSave={onSave} onCancel={() => {}} />,
    )

    fireEvent.change(screen.getByLabelText('Rating (0–100)'), {
      target: { value: '101' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Rating must be between 0 and 100',
    )
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Rating (0–100)'), {
      target: { value: '90' },
    })
    fireEvent.change(screen.getByLabelText('Price paid'), {
      target: { value: '-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Price paid cannot be negative',
    )
    expect(onSave).not.toHaveBeenCalled()
  })
})
