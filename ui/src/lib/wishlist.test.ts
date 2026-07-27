import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseWishlistInput, saveWishlistEntry } from './cellar'
import type { WishlistInput } from './cellar'

function input(overrides: Partial<WishlistInput> = {}): WishlistInput {
  return {
    matchedWineId: null,
    producer: 'Overnoy',
    wine_name: 'Ploussard',
    vintage: '2021',
    wine_type: 'red',
    region: 'Jura',
    country: 'France',
    recommended_by: 'Marta',
    reason: 'Poured it at dinner',
    shop_name: 'Chambers Street',
    listed_price: '62',
    ...overrides,
  }
}

describe('parseWishlistInput', () => {
  it('normalises a new-wine entry', () => {
    const result = parseWishlistInput(input())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wineId).toBeNull()
    expect(result.value.wine).toMatchObject({
      producer: 'Overnoy',
      wine_name: 'Ploussard',
      vintage: '2021',
    })
    expect(result.value.entry).toMatchObject({
      recommended_by: 'Marta',
      shop_name: 'Chambers Street',
      listed_price: 62,
    })
  })

  it('skips wine creation when an existing wine is matched', () => {
    const result = parseWishlistInput(
      input({ matchedWineId: 42, producer: '', wine_name: '' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wineId).toBe(42)
    expect(result.value.wine).toBeNull()
  })

  it('treats a blank price as absent rather than zero', () => {
    const result = parseWishlistInput(input({ listed_price: '  ' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entry.listed_price).toBeNull()
  })

  it('trims whitespace off free-text fields', () => {
    const result = parseWishlistInput(
      input({ producer: '  Overnoy  ', recommended_by: '  Marta  ' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wine?.producer).toBe('Overnoy')
    expect(result.value.entry.recommended_by).toBe('Marta')
  })

  it.each([
    ['-5', 'negative'],
    ['cheap', 'not a number'],
  ])('rejects price %s (%s)', (listed_price) => {
    const result = parseWishlistInput(input({ listed_price }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/price/i)
  })

  it('requires producer and wine name for an unmatched wine', () => {
    const result = parseWishlistInput(input({ producer: '   ' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/producer/i)
  })

  it('accepts a bare recommendation with no shop or price', () => {
    const result = parseWishlistInput(
      input({ shop_name: '', listed_price: '' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entry.recommended_by).toBe('Marta')
    expect(result.value.entry.listed_price).toBeNull()
  })
})

describe('saveWishlistEntry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    const calls: Array<{ url: string; body: any }> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })
      return {
        ok: true,
        json: async () => ({ id: 777, quantity: 0 }),
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    return calls
  }

  it('creates the wine with zero bottles, then files the wishlist entry', async () => {
    const calls = stubFetch()
    const parsed = parseWishlistInput(input())
    if (!parsed.ok) throw new Error('expected valid input')

    await saveWishlistEntry(parsed.value)

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/api/cellar/items')
    // No bottles: wanting a wine must not add it to inventory.
    expect(calls[0].body.quantity).toBe(0)
    expect(calls[1].url).toContain('/api/wishlist')
    expect(calls[1].body.wine_id).toBe(777)
    expect(calls[1].body.recommended_by).toBe('Marta')
  })

  it('files against the matched wine without creating a duplicate', async () => {
    const calls = stubFetch()
    const parsed = parseWishlistInput(input({ matchedWineId: 42 }))
    if (!parsed.ok) throw new Error('expected valid input')

    await saveWishlistEntry(parsed.value)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/wishlist')
    expect(calls[0].body.wine_id).toBe(42)
  })
})
