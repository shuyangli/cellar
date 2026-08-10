import { useState } from 'react'

import { ReviewerSelect } from '#/components/reviewer-select'
import { Button } from '#/components/ui/button'
import type { TastingDraft } from '#/lib/cellar'

const inputClass =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function InventoryEventReviewForm({
  eventDate,
  onSave,
  onSaved,
  onCancel,
}: {
  eventDate: string
  onSave: (review: TastingDraft) => Promise<unknown>
  onSaved: () => void
  onCancel: () => void
}) {
  const [user, setUser] = useState('')
  const [rating, setRating] = useState('')
  const [tastedOn, setTastedOn] = useState(eventDate.slice(0, 10))
  const [notes, setNotes] = useState('')
  const [foodPairing, setFoodPairing] = useState('')
  const [buyAgain, setBuyAgain] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const parsedRating = rating.trim() === '' ? null : Number(rating)
    if (
      parsedRating != null &&
      (!Number.isInteger(parsedRating) ||
        parsedRating < 0 ||
        parsedRating > 100)
    ) {
      setError('Rating must be between 0 and 100.')
      return
    }

    setSaving(true)
    try {
      await onSave({
        user: user.trim() || undefined,
        rating: parsedRating,
        tasting_notes: notes.trim(),
        food_pairing: foodPairing.trim(),
        context_type: 'home',
        buy_again: buyAgain,
        tasted_on: tastedOn,
        consume_bottle: false,
      })
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Reviewer</span>
        <ReviewerSelect value={user} onChange={setUser} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Rating (0–100)</span>
        <input
          aria-label="Rating (0–100)"
          inputMode="numeric"
          className={inputClass}
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          placeholder="93"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Tasted on</span>
        <input
          aria-label="Tasted on"
          type="date"
          className={inputClass}
          value={tastedOn}
          onChange={(event) => setTastedOn(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Food pairing</span>
        <input
          aria-label="Food pairing"
          className={inputClass}
          value={foodPairing}
          onChange={(event) => setFoodPairing(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs text-muted-foreground">Notes</span>
        <textarea
          aria-label="Notes"
          className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What stood out?"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <label className="mr-auto flex min-h-9 items-center gap-2 text-sm">
          <input
            aria-label="Would buy again"
            type="checkbox"
            className="size-4"
            checked={buyAgain}
            onChange={(event) => setBuyAgain(event.target.checked)}
          />
          Would buy again
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save review'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      ) : null}
    </form>
  )
}
