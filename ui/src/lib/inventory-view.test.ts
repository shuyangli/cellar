import { describe, expect, it, vi } from 'vitest'

import { adjustInventoryAndRefresh, mobileWineSummary } from './inventory-view'

describe('adjustInventoryAndRefresh', () => {
  it('reports a successful mutation and refresh', async () => {
    const adjust = vi.fn().mockResolvedValue({ quantity: 1 })
    const refresh = vi.fn().mockResolvedValue(undefined)

    await expect(adjustInventoryAndRefresh(adjust, refresh)).resolves.toEqual({
      kind: 'refreshed',
    })
    expect(adjust).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('distinguishes a refresh failure after a successful mutation', async () => {
    const adjust = vi.fn().mockResolvedValue({ quantity: 0 })
    const refresh = vi.fn().mockRejectedValue(new Error('router offline'))

    await expect(adjustInventoryAndRefresh(adjust, refresh)).resolves.toEqual({
      kind: 'refresh_failed',
    })
    expect(adjust).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when the inventory mutation fails', async () => {
    const adjust = vi.fn().mockRejectedValue(new Error('out of stock'))
    const refresh = vi.fn()

    await expect(adjustInventoryAndRefresh(adjust, refresh)).resolves.toEqual({
      kind: 'mutation_failed',
      message: 'out of stock',
    })
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('mobileWineSummary', () => {
  it('keeps wine type and varietal when both are present', () => {
    expect(
      mobileWineSummary({
        vintage: '2020',
        wine_type: 'sparkling',
        varietal: 'Chardonnay',
        region: 'Champagne',
      }),
    ).toBe('2020 · sparkling · Chardonnay · Champagne')
  })

  it('does not mislabel an unknown vintage as non-vintage', () => {
    expect(
      mobileWineSummary({
        vintage: null,
        wine_type: 'red',
        varietal: 'Malbec',
        region: 'Mendoza',
      }),
    ).toBe('Vintage unknown · red · Malbec · Mendoza')
  })
})
