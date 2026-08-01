// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { DrinkingWindow, drinkingYearState } from './drinking-window'

afterEach(cleanup)

describe('drinkingYearState', () => {
  it('classifies window years relative to the current year', () => {
    expect(drinkingYearState('2020', 2026)).toBe('past')
    expect(drinkingYearState('best from 2026', 2026)).toBe('current')
    expect(drinkingYearState('2032+', 2026)).toBe('future')
    expect(drinkingYearState('open', 2026)).toBe('unknown')
  })
})

describe('DrinkingWindow', () => {
  it('fades elapsed years and distinguishes future years', () => {
    render(<DrinkingWindow start="2020" end="2032" year={2026} />)

    expect(screen.getByText('2020').dataset.yearState).toBe('past')
    expect(screen.getByText('2032').dataset.yearState).toBe('future')
    expect(screen.getByText('2020').className).toContain('opacity-50')
    expect(screen.getByText('2032').className).toContain('text-amber')
    expect(screen.getByText('to').className).toContain('sr-only')
    expect(screen.getByText('2020').parentElement?.className).toContain(
      'whitespace-nowrap',
    )
  })

  it('renders open-ended windows without inventing a year', () => {
    render(<DrinkingWindow start="2026" end={null} year={2026} />)
    expect(screen.getByText('open')).toBeDefined()
  })
})
