import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseExternalTasting, saveExternalTasting } from './cellar'
import type { ExternalTastingInput } from './cellar'

function input(
  overrides: Partial<ExternalTastingInput> = {},
): ExternalTastingInput {
  return {
    matchedWineId: null,
    producer: 'Domaine Roulot',
    wine_name: 'Meursault',
    vintage: '2019',
    wine_type: 'white',
    region: 'Burgundy',
    country: 'France',
    context_type: 'restaurant',
    venue: 'Frenchette',
    tasted_on: '2026-07-27',
    rating: '93',
    price_paid: '24',
    buy_again: true,
    notes: 'Superb.',
    ...overrides,
  }
}

describe('parseExternalTasting', () => {
  it('normalises a new-wine entry', () => {
    const result = parseExternalTasting(input())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wineId).toBeNull()
    expect(result.value.wine).toMatchObject({
      producer: 'Domaine Roulot',
      wine_name: 'Meursault',
      vintage: '2019',
    })
    expect(result.value.tasting).toMatchObject({
      rating: 93,
      price_paid: 24,
      context_type: 'restaurant',
      venue: 'Frenchette',
      buy_again: true,
    })
  })

  it('skips wine creation when an existing wine is matched', () => {
    const result = parseExternalTasting(
      input({ matchedWineId: 42, producer: '', wine_name: '' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wineId).toBe(42)
    expect(result.value.wine).toBeNull()
  })

  it('treats blank rating and price as absent rather than zero', () => {
    const result = parseExternalTasting(input({ rating: '  ', price_paid: '' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tasting.rating).toBeNull()
    expect(result.value.tasting.price_paid).toBeNull()
  })

  it('trims whitespace off free-text fields', () => {
    const result = parseExternalTasting(
      input({ producer: '  Roulot  ', venue: '  Frenchette  ' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.wine?.producer).toBe('Roulot')
    expect(result.value.tasting.venue).toBe('Frenchette')
  })

  it.each([
    ['101', 'out of range high'],
    ['-1', 'out of range low'],
    ['92.5', 'not a whole number'],
    ['great', 'not a number'],
  ])('rejects rating %s (%s)', (rating) => {
    const result = parseExternalTasting(input({ rating }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/rating/i)
  })

  it('accepts the rating boundaries', () => {
    expect(parseExternalTasting(input({ rating: '0' })).ok).toBe(true)
    expect(parseExternalTasting(input({ rating: '100' })).ok).toBe(true)
  })

  it('rejects a negative price', () => {
    const result = parseExternalTasting(input({ price_paid: '-5' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/price/i)
  })

  it('requires producer and wine name for an unmatched wine', () => {
    const result = parseExternalTasting(input({ producer: '   ' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/producer/i)
  })
})

describe('saveExternalTasting', () => {
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

  it('creates the wine with zero bottles, then logs the tasting against it', async () => {
    const calls = stubFetch()
    const parsed = parseExternalTasting(input())
    if (!parsed.ok) throw new Error('expected valid input')

    await saveExternalTasting(parsed.value)

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/api/cellar/items')
    // No bottles: a wine tasted elsewhere must not enter inventory.
    expect(calls[0].body.quantity).toBe(0)
    expect(calls[1].url).toContain('/api/wines/777/tastings')
    expect(calls[1].body.consume_bottle).toBe(false)
    expect(calls[1].body.venue).toBe('Frenchette')
  })

  it('logs against the matched wine without creating a duplicate', async () => {
    const calls = stubFetch()
    const parsed = parseExternalTasting(input({ matchedWineId: 42 }))
    if (!parsed.ok) throw new Error('expected valid input')

    await saveExternalTasting(parsed.value)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/wines/42/tastings')
    expect(calls[0].body.consume_bottle).toBe(false)
  })

  it('never consumes a bottle even if a caller asks it to', async () => {
    const calls = stubFetch()
    const parsed = parseExternalTasting(input({ matchedWineId: 42 }))
    if (!parsed.ok) {
      throw new Error('expected valid input')
    }
    // Simulate a caller trying to opt into consumption.
    const tasting = parsed.value.tasting as Record<string, unknown>
    tasting.consume_bottle = true

    await saveExternalTasting(parsed.value)

    expect(calls[0].body.consume_bottle).toBe(false)
  })
})
