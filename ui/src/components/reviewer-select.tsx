import { useEffect, useState } from 'react'

import { fetchUsers } from '#/lib/cellar'
import type { User } from '#/lib/cellar'

const inputClass =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Sentinel option that swaps the picker for a free-text name field.
 * Deliberately not a plausible name, and free of characters a DOM value
 * round-trip could normalise away.
 */
const NEW_REVIEWER = '__new_reviewer__'

/** The reviewer to preselect, or undefined when nobody is on file yet. */
function defaultReviewer(users: Array<User>): string | undefined {
  return (users.find((user) => user.is_default) ?? users.at(0))?.name
}

/**
 * Picks who a rating belongs to. Known reviewers are listed; naming someone new
 * creates them on save, so the cellar is never limited to a fixed household.
 *
 * `value` is the reviewer's name, or '' for the default reviewer.
 */
export function ReviewerSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (name: string) => void
}) {
  const [users, setUsers] = useState<Array<User> | null>(null)
  const [naming, setNaming] = useState(false)

  useEffect(() => {
    let live = true
    void fetchUsers()
      .then((loaded) => {
        if (!live) return
        setUsers(loaded)
        // Default to whoever the API marks default, so the common case is one click.
        const fallback = defaultReviewer(loaded)
        if (!value && fallback) onChange(fallback)
      })
      .catch(() => {
        // A failed load just means typing a name instead of picking one.
        if (live) setUsers([])
      })
    return () => {
      live = false
    }
    // Run once: reloading on every keystroke would fight the user's typing.
  }, [])

  if (users == null) {
    return (
      <div className={`${inputClass} flex items-center text-muted-foreground`}>
        Loading reviewers…
      </div>
    )
  }

  const known = users.some((user) => user.name === value)

  if (naming || (!known && value !== '')) {
    return (
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          value={value}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          placeholder="Reviewer's name"
        />
        <button
          type="button"
          className="text-xs whitespace-nowrap text-muted-foreground hover:text-foreground"
          onClick={() => {
            setNaming(false)
            onChange(defaultReviewer(users) ?? '')
          }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <select
      className={inputClass}
      value={value}
      onChange={(event) => {
        if (event.target.value === NEW_REVIEWER) {
          setNaming(true)
          onChange('')
          return
        }
        onChange(event.target.value)
      }}
    >
      {users.map((user) => (
        <option key={user.id} value={user.name}>
          {user.name} ({user.initials})
        </option>
      ))}
      <option value={NEW_REVIEWER}>Someone else…</option>
    </select>
  )
}
