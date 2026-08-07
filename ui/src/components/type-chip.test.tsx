// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TypeChip } from '#/routes/index'

afterEach(cleanup)

describe('TypeChip', () => {
  it('uses a 44px mobile touch target and preserves a compact desktop control', () => {
    render(<TypeChip label="sparkling" active={false} onClick={() => {}} />)

    const chip = screen.getByRole('button', { name: 'sparkling' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    expect(chip.className).toContain('min-h-11')
    expect(chip.className).toContain('sm:min-h-0')
  })

  it('exposes selection state and handles taps', () => {
    const onClick = vi.fn()
    render(<TypeChip label="red" active onClick={onClick} />)

    const chip = screen.getByRole('button', { name: 'red' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
