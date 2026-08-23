// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditCard, ExternalSources } from './wine.$wineId'
import type { WineDossier } from '#/lib/cellar'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function wineWith(overrides: Partial<WineDossier>): WineDossier {
  return {
    vivino_url: null,
    vivino_rating: null,
    vivino_price: null,
    vivino_price_currency: null,
    cellartracker_url: null,
    cellartracker_rating: null,
    cellartracker_price: null,
    cellartracker_price_currency: null,
    ...overrides,
  } as WineDossier
}

describe('ExternalSources', () => {
  it('shows each provider link, native rating scale, and listed price in details content', () => {
    render(
      <ExternalSources
        wine={wineWith({
          vivino_url: 'https://www.vivino.com/en/example/w/123',
          vivino_rating: 4.2,
          vivino_price: 42.99,
          vivino_price_currency: 'USD',
          cellartracker_url: 'https://www.cellartracker.com/wine.asp?iWine=456',
          cellartracker_rating: 91.4,
          cellartracker_price: 38,
          cellartracker_price_currency: 'USD',
        })}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'External sources' }),
    ).toBeDefined()
    expect(
      screen.getByRole('link', { name: /Vivino/ }).getAttribute('href'),
    ).toContain('/w/123')
    expect(
      screen.getByRole('link', { name: /CellarTracker/ }).getAttribute('href'),
    ).toContain('iWine=456')
    expect(screen.getByText('4.2 / 5')).toBeDefined()
    expect(screen.getByText('91.4 / 100')).toBeDefined()
    expect(screen.getByText('$42.99')).toBeDefined()
    expect(screen.getByText('$38.00')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps an existing link in details when rating and price are unavailable', () => {
    render(
      <ExternalSources
        wine={wineWith({
          vivino_url: 'https://www.vivino.com/en/example/w/123',
        })}
      />,
    )
    expect(screen.getByRole('link', { name: /Vivino/ })).toBeDefined()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('uses native currency precision', () => {
    render(
      <ExternalSources
        wine={wineWith({
          vivino_url: 'https://www.vivino.com/en/example/w/123',
          vivino_price: 4200,
          vivino_price_currency: 'JPY',
        })}
      />,
    )
    expect(screen.getByText('¥4,200')).toBeDefined()
  })

  it('sends null when an existing provider number is cleared', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(wineWith({ id: 1 })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <EditCard
        wine={wineWith({ id: 1, vivino_rating: 4.2 })}
        onSaved={() => undefined}
        onError={(message) => {
          throw new Error(message)
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Vivino rating (0–5)'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({ vivino_rating: null })
    vi.unstubAllGlobals()
  })

  it('includes unchanged currency when replacing a provider link and price', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(wineWith({ id: 2 })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <EditCard
        wine={wineWith({
          id: 2,
          vivino_url: 'https://www.vivino.com/en/original/w/123',
          vivino_price: 20,
          vivino_price_currency: 'USD',
        })}
        onSaved={() => undefined}
        onError={(message) => {
          throw new Error(message)
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Vivino URL'), {
      target: { value: 'https://www.vivino.com/en/replacement/w/124' },
    })
    fireEvent.change(screen.getByLabelText('Vivino listed price'), {
      target: { value: '25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      vivino_url: 'https://www.vivino.com/en/replacement/w/124',
      vivino_price: 25,
      vivino_price_currency: 'USD',
    })
  })

  it('omits the section when neither provider has a link or market data', () => {
    const { container } = render(<ExternalSources wine={wineWith({})} />)
    expect(container.innerHTML).toBe('')
  })
})
