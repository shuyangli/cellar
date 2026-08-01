// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { WineTypeIcon } from './wine-type-icon'

afterEach(cleanup)

describe('WineTypeIcon', () => {
  it.each([
    ['red', 'Red wine', '#7f1d3f'],
    ['white', 'White wine', '#e7c96b'],
    ['rose', 'Rosé wine', '#e8909d'],
    ['orange', 'Orange wine', '#d97706'],
  ])(
    'renders a %s wine marker with the expected color',
    (type, label, color) => {
      const { container } = render(<WineTypeIcon wineType={type} />)
      expect(screen.getByRole('img', { name: label })).toBeDefined()
      expect(container.querySelector(`path[fill="${color}"]`)).not.toBeNull()
    },
  )

  it('adds bubbles for sparkling wine', () => {
    const { container } = render(<WineTypeIcon wineType="sparkling" />)
    expect(screen.getByRole('img', { name: 'Sparkling wine' })).toBeDefined()
    expect(container.querySelectorAll('circle')).toHaveLength(5)
  })

  it('uses a neutral accessible fallback for missing types', () => {
    render(<WineTypeIcon wineType={null} />)
    expect(screen.getByRole('img', { name: 'Wine type unknown' })).toBeDefined()
  })
})
