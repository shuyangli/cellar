import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchOrderedWines, markOrderedWineArrived } from './cellar'

afterEach(() => vi.unstubAllGlobals())

describe('ordered wine API', () => {
  it('loads only outstanding orders by default', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => [],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOrderedWines()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/ordered-wines')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(
      'include_arrived=true',
    )
  })

  it('posts an idempotent arrival action', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ id: 8, status: 'arrived' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await markOrderedWineArrived(8, '2026-08-09')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/ordered-wines/8/arrive')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ arrived_on: '2026-08-09' })
  })

  it('omits the arrival date when using the default-today action', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ id: 8, status: 'arrived' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await markOrderedWineArrived(8)

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({})
  })
})
