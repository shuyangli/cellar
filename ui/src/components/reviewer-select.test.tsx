// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useState } from 'react'

import { ReviewerSelect } from './reviewer-select'

const USERS = [
  {
    id: 1,
    name: 'Shuyang',
    is_default: 1,
    initials: 'S',
    tasting_count: 3,
    last_tasted_on: null,
  },
  {
    id: 2,
    name: 'Alex',
    is_default: 0,
    initials: 'A',
    tasting_count: 1,
    last_tasted_on: null,
  },
]

function stubUsers(payload: unknown = USERS, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => ({ ok, json: async () => payload }) as unknown as Response,
    ),
  )
}

/** Mirrors how the tasting form owns the value. */
function Harness({ onValue }: { onValue?: (name: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <ReviewerSelect
      value={value}
      onChange={(name) => {
        setValue(name)
        onValue?.(name)
      }}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReviewerSelect', () => {
  it('lists known reviewers with their initials', async () => {
    stubUsers()
    render(<Harness />)

    await waitFor(() => expect(screen.getByText('Shuyang (S)')).toBeDefined())
    expect(screen.getByText('Alex (A)')).toBeDefined()
  })

  it('preselects the default reviewer so the common case is one click', async () => {
    stubUsers()
    const seen: Array<string> = []
    render(<Harness onValue={(name) => seen.push(name)} />)

    await waitFor(() => expect(seen).toContain('Shuyang'))
  })

  it('lets a new person be named, so reviewers are not a fixed set', async () => {
    stubUsers()
    const seen: Array<string> = []
    render(<Harness onValue={(name) => seen.push(name)} />)
    await waitFor(() => expect(screen.getByText('Shuyang (S)')).toBeDefined())

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '__new_reviewer__' },
    })
    const input = await screen.findByPlaceholderText("Reviewer's name")
    fireEvent.change(input, { target: { value: 'Marta' } })

    expect(seen.at(-1)).toBe('Marta')
  })

  it('falls back to a name field when the reviewer list cannot load', async () => {
    stubUsers(null, false)
    render(<Harness />)

    // No list means no picker, but a rating must still be attributable.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeDefined())
    expect(screen.queryByText('Shuyang (S)')).toBeNull()
  })
})
