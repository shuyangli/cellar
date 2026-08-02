import { useState } from 'react'

import { ReviewerSelect } from '#/components/reviewer-select'
import { Button } from '#/components/ui/button'
import { TASTING_CONTEXT_OPTIONS } from '#/lib/cellar'
import type { Tasting, TastingUpdate } from '#/lib/cellar'

const inputClass =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
const EDITOR_CONTEXT_OPTIONS = ['home', ...TASTING_CONTEXT_OPTIONS]

function Field({
  label,
  children,
  span = false,
}: {
  label: string
  children: React.ReactNode
  span?: boolean
}) {
  return (
    <label className={`flex flex-col gap-1 ${span ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export function TastingEditor({
  tasting,
  onSave,
  onSaved,
  onCancel,
}: {
  tasting: Tasting
  onSave: (update: TastingUpdate) => Promise<unknown>
  onSaved?: () => void
  onCancel: () => void
}) {
  const [user, setUser] = useState(tasting.user_name ?? '')
  const [rating, setRating] = useState(
    tasting.rating == null ? '' : String(tasting.rating),
  )
  const [contextType, setContextType] = useState(tasting.context_type || 'home')
  const [venue, setVenue] = useState(tasting.venue ?? '')
  const [pricePaid, setPricePaid] = useState(
    tasting.price_paid == null ? '' : String(tasting.price_paid),
  )
  const [tastedOn, setTastedOn] = useState(tasting.tasted_on ?? '')
  const [liked, setLiked] = useState(Boolean(tasting.liked))
  const [buyAgain, setBuyAgain] = useState(Boolean(tasting.buy_again))
  const [notes, setNotes] = useState(tasting.tasting_notes ?? '')
  const [foodPairing, setFoodPairing] = useState(tasting.food_pairing ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contextOptions = EDITOR_CONTEXT_OPTIONS.some(
    (option) => option === contextType,
  )
    ? EDITOR_CONTEXT_OPTIONS
    : [contextType, ...EDITOR_CONTEXT_OPTIONS]

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
    const parsedPrice = pricePaid.trim() === '' ? null : Number(pricePaid)
    if (
      parsedPrice != null &&
      (!Number.isFinite(parsedPrice) || parsedPrice < 0)
    ) {
      setError('Price paid cannot be negative.')
      return
    }

    setSaving(true)
    try {
      const update: TastingUpdate = {
        rating: parsedRating,
        tasting_notes: notes.trim(),
        food_pairing: foodPairing.trim(),
        context_type: contextType,
        venue: venue.trim(),
        price_paid: parsedPrice,
        liked,
        buy_again: buyAgain,
        tasted_on: tastedOn,
      }
      if (user.trim() || tasting.user_name !== null) {
        update.user = user.trim() || null
      }
      await onSave(update)
      onSaved?.()
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
      <Field label="Reviewer">
        <ReviewerSelect value={user} onChange={setUser} allowUnassigned />
      </Field>
      <Field label="Rating (0–100)">
        <input
          aria-label="Rating (0–100)"
          inputMode="numeric"
          className={inputClass}
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          placeholder="93"
        />
      </Field>
      <Field label="Where">
        <select
          aria-label="Where"
          className={inputClass}
          value={contextType}
          onChange={(event) => setContextType(event.target.value)}
        >
          {contextOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Venue">
        <input
          aria-label="Venue"
          className={inputClass}
          value={venue}
          onChange={(event) => setVenue(event.target.value)}
        />
      </Field>
      <Field label="Tasted on">
        <input
          aria-label="Tasted on"
          type="date"
          className={inputClass}
          value={tastedOn}
          onChange={(event) => setTastedOn(event.target.value)}
        />
      </Field>
      <Field label="Price paid">
        <input
          aria-label="Price paid"
          inputMode="decimal"
          className={inputClass}
          value={pricePaid}
          onChange={(event) => setPricePaid(event.target.value)}
        />
      </Field>
      <Field label="Notes" span>
        <textarea
          aria-label="Notes"
          className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <Field label="Food pairing" span>
        <input
          aria-label="Food pairing"
          className={inputClass}
          value={foodPairing}
          onChange={(event) => setFoodPairing(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={liked}
            onChange={(event) => setLiked(event.target.checked)}
            aria-label="Liked"
          />
          Liked
        </label>
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
          onClick={onCancel}
          disabled={saving}
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
