// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import { ExternalTastingForm } from './external-tasting-form'

// The form only needs the router to refresh the tasting list after saving.
// vi.mock is hoisted above the imports, so declaring it here is fine.
const invalidate = vi.fn(async () => {})
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
}))

type Call = { url: string; method: string; body: any }

function stubFetch(overrides: Record<string, unknown> = {}) {
  const calls: Array<Call> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })
      return {
        ok: true,
        json: async () => ({ id: 777, quantity: 0, ...overrides }),
      } as unknown as Response
    }),
  )
  return calls
}

function fill(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  invalidate.mockClear()
})

describe('ExternalTastingForm', () => {
  it('renders the fields needed to log a wine tasted elsewhere', () => {
    stubFetch()
    render(<ExternalTastingForm onDone={() => {}} />)

    expect(screen.getByPlaceholderText('Producer *')).toBeDefined()
    expect(screen.getByPlaceholderText('Wine name *')).toBeDefined()
    expect(screen.getByPlaceholderText('Restaurant or bar name')).toBeDefined()
    expect(screen.getByPlaceholderText('93')).toBeDefined()
    expect(screen.getByText('Save tasting')).toBeDefined()
    expect(screen.queryByRole('option', { name: 'home' })).toBeNull()
  })

  it('defaults the tasting date to today so the common case needs no typing', () => {
    stubFetch()
    const { container } = render(<ExternalTastingForm onDone={() => {}} />)
    const date = container.querySelector<HTMLInputElement>('input[type="date"]')
    expect(date?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('saves a new wine with no bottles, then its tasting, then closes', async () => {
    const calls = stubFetch()
    const onDone = vi.fn()
    render(<ExternalTastingForm onDone={onDone} />)

    fill('Producer *', 'Domaine Roulot')
    fill('Wine name *', 'Meursault')
    fill('Restaurant or bar name', 'Frenchette')
    fill('93', '95')
    fireEvent.click(screen.getByText('Save tasting'))

    await waitFor(() => expect(onDone).toHaveBeenCalled())

    const writes = calls.filter((c) => c.method === 'POST')
    expect(writes).toHaveLength(2)
    expect(writes[0].url).toContain('/api/cellar/items')
    expect(writes[0].body.quantity).toBe(0)
    expect(writes[0].body.producer).toBe('Domaine Roulot')
    expect(writes[1].url).toContain('/api/wines/777/tastings')
    expect(writes[1].body.consume_bottle).toBe(false)
    expect(writes[1].body.venue).toBe('Frenchette')
    expect(writes[1].body.rating).toBe(95)
    expect(writes[1].body.context_type).toBe('restaurant')
    expect(invalidate).toHaveBeenCalled()
  })

  it('shows a validation error and writes nothing when the wine is unnamed', async () => {
    const calls = stubFetch()
    const onDone = vi.fn()
    render(<ExternalTastingForm onDone={onDone} />)

    fireEvent.click(screen.getByText('Save tasting'))

    await screen.findByText(/producer and wine name are required/i)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('surfaces a server error instead of silently closing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ detail: 'vintage must be a year' }),
      })),
    )
    const onDone = vi.fn()
    render(<ExternalTastingForm onDone={onDone} />)

    fill('Producer *', 'Domaine Roulot')
    fill('Wine name *', 'Meursault')
    fireEvent.click(screen.getByText('Save tasting'))

    await screen.findByText('vintage must be a year')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('logs against an existing wine instead of creating a duplicate', async () => {
    const calls = stubFetch()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        })
        if (url.includes('/api/cellar?')) {
          return {
            ok: true,
            json: async () => ({
              items: [
                {
                  id: 42,
                  producer: 'Bodegas El Coto',
                  wine_name: 'Rioja Reserva',
                  vintage: '2018',
                  quantity: 3,
                },
              ],
            }),
          } as unknown as Response
        }
        return {
          ok: true,
          json: async () => ({ id: 42, quantity: 3 }),
        } as unknown as Response
      }),
    )
    const onDone = vi.fn()
    render(<ExternalTastingForm onDone={onDone} />)

    fill('Search wines already on file…', 'coto')
    fireEvent.click(screen.getByText('Search'))

    const match = await screen.findByText(/Bodegas El Coto/)
    fireEvent.click(match)

    fireEvent.click(screen.getByText('Save tasting'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())

    const writes = calls.filter((c) => c.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0].url).toContain('/api/wines/42/tastings')
    // Critical: tasting a wine we still own elsewhere must not drain stock.
    expect(writes[0].body.consume_bottle).toBe(false)
  })
})
