// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { RatingBadge, RatingBadges } from './rating-badge'
import type { RatingByUser } from '#/lib/cellar'

function rating(overrides: Partial<RatingByUser> = {}): RatingByUser {
  return {
    user_id: 1,
    user_name: 'Shuyang',
    initials: 'S',
    rating: 89,
    tastings: 1,
    ...overrides,
  }
}

afterEach(cleanup)

describe('RatingBadge', () => {
  it('renders the rating with the reviewer initials appended', () => {
    render(<RatingBadge rating={89} initials="S" />)
    expect(screen.getByText('89')).toBeDefined()
    expect(screen.getByText('S')).toBeDefined()
  })

  it('renders a bare rating when no reviewer is known', () => {
    const { container } = render(<RatingBadge rating={89} initials={null} />)
    expect(container.textContent).toBe('89')
  })

  it('flips between the initial and the full name when tapped', () => {
    const { container } = render(
      <RatingBadge rating={89} initials="S" name="Shuyang" />,
    )
    const badge = screen.getByRole('button')
    expect(container.textContent).toBe('89S')
    fireEvent.click(badge)
    expect(container.textContent).toBe('89Shuyang')
    fireEvent.click(badge)
    expect(container.textContent).toBe('89S')
  })

  it('stays inert when no name is available to flip to', () => {
    render(<RatingBadge rating={89} initials="S" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('RatingBadges', () => {
  it('shows one badge per reviewer', () => {
    const { container } = render(
      <RatingBadges
        ratings={[
          rating(),
          rating({ user_id: 2, user_name: 'Alex', initials: 'A', rating: 90 }),
        ]}
      />,
    )
    expect(container.textContent).toContain('89S')
    expect(container.textContent).toContain('90A')
  })

  it('renders nothing when the wine has no ratings', () => {
    const { container } = render(<RatingBadges ratings={[]} />)
    expect(container.textContent).toBe('')
  })

  it('explains an averaged badge in its tooltip', () => {
    render(<RatingBadges ratings={[rating({ rating: 90, tastings: 2 })]} />)
    expect(screen.getByTitle('Shuyang — average of 2 tastings')).toBeDefined()
  })

  it('flips one reviewer to their full name without touching the others', () => {
    const { container } = render(
      <RatingBadges
        ratings={[
          rating(),
          rating({ user_id: 2, user_name: 'Sam', initials: 'S', rating: 85 }),
        ]}
      />,
    )
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(container.textContent).toContain('89Shuyang')
    // Sam's badge stays collapsed — its name must not have leaked in too.
    expect(container.textContent).not.toContain('Sam')
    expect(container.textContent).toContain('85S')
  })
})
