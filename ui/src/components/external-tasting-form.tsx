import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Card, CardContent } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  fetchCellar,
  formatWineTitle,
  parseExternalTasting,
  saveExternalTasting,
  TASTING_CONTEXT_OPTIONS,
  WINE_TYPE_OPTIONS,
} from '#/lib/cellar'
import type { CellarItem } from '#/lib/cellar'

const inputClass =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

function today(): string {
  const now = new Date()
  const offsetMs = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10)
}

/**
 * Logs a wine tasted away from the cellar. The wine may already be known (we
 * own it, or tasted it before) — matching against an existing row keeps its
 * tasting history in one place instead of forking it across duplicates.
 */
export function ExternalTastingForm({ onDone }: { onDone: () => void }) {
  const router = useRouter()

  const [matched, setMatched] = useState<CellarItem | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<CellarItem> | null>(null)
  const [searching, setSearching] = useState(false)

  const [producer, setProducer] = useState('')
  const [wineName, setWineName] = useState('')
  const [vintage, setVintage] = useState('')
  const [wineType, setWineType] = useState('')
  const [region, setRegion] = useState('')
  const [country, setCountry] = useState('')

  const [contextType, setContextType] = useState('restaurant')
  const [venue, setVenue] = useState('')
  const [tastedOn, setTastedOn] = useState(today())
  const [rating, setRating] = useState('')
  const [pricePaid, setPricePaid] = useState('')
  const [buyAgain, setBuyAgain] = useState(false)
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    const term = query.trim()
    if (!term) return
    setSearching(true)
    setError(null)
    try {
      // in_stock: false so we also match wines we've finished or only tasted.
      const payload = await fetchCellar(1, 8, { q: term, in_stock: false })
      setResults(payload.items)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSearching(false)
    }
  }

  const chooseMatch = (item: CellarItem) => {
    setMatched(item)
    setResults(null)
    setQuery('')
  }

  const submit = async () => {
    setError(null)
    const parsed = parseExternalTasting({
      matchedWineId: matched?.id ?? null,
      producer,
      wine_name: wineName,
      vintage,
      wine_type: wineType,
      region,
      country,
      context_type: contextType,
      venue,
      tasted_on: tastedOn,
      rating,
      price_paid: pricePaid,
      buy_again: buyAgain,
      notes,
    })
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    setSaving(true)
    try {
      await saveExternalTasting(parsed.value)
      await router.invalidate()
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-base font-medium">
            Tasted somewhere else
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Records the wine and your review without touching cellar inventory.
          </p>
        </div>

        <Field label="Wine">
          {matched ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-sm font-medium">
                {formatWineTitle(matched)}
              </span>
              {matched.quantity > 0 ? (
                <Badge variant="secondary" className="text-[10px]">
                  {matched.quantity} in cellar
                </Badge>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setMatched(null)}
              >
                Change
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void search()
                    }
                  }}
                  placeholder="Search wines already on file…"
                />
                <Button
                  variant="outline"
                  size="lg"
                  disabled={searching || !query.trim()}
                  onClick={() => void search()}
                >
                  {searching ? 'Searching…' : 'Search'}
                </Button>
              </div>

              {results != null ? (
                results.length > 0 ? (
                  <ul className="flex flex-col gap-1 rounded-md border p-1">
                    {results.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => chooseMatch(item)}
                          className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          {formatWineTitle(item)}
                          {item.quantity > 0 ? (
                            <span className="text-muted-foreground">
                              {' '}
                              · {item.quantity} in cellar
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No match — fill in the details below to add it.
                  </p>
                )
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className={inputClass}
                  value={producer}
                  onChange={(event) => setProducer(event.target.value)}
                  placeholder="Producer *"
                />
                <input
                  className={inputClass}
                  value={wineName}
                  onChange={(event) => setWineName(event.target.value)}
                  placeholder="Wine name *"
                />
                <input
                  className={inputClass}
                  value={vintage}
                  onChange={(event) => setVintage(event.target.value)}
                  placeholder="Vintage"
                />
                <select
                  className={inputClass}
                  value={wineType}
                  onChange={(event) => setWineType(event.target.value)}
                >
                  <option value="">Type…</option>
                  {WINE_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder="Region"
                />
                <input
                  className={inputClass}
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  placeholder="Country"
                />
              </div>
            </div>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Where">
            <select
              className={inputClass}
              value={contextType}
              onChange={(event) => setContextType(event.target.value)}
            >
              {TASTING_CONTEXT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue">
            <input
              className={inputClass}
              value={venue}
              onChange={(event) => setVenue(event.target.value)}
              placeholder="Restaurant or bar name"
            />
          </Field>
          <Field label="Tasted on">
            <input
              type="date"
              className={inputClass}
              value={tastedOn}
              onChange={(event) => setTastedOn(event.target.value)}
            />
          </Field>
          <Field label="Rating (0–100)">
            <input
              inputMode="numeric"
              className={inputClass}
              value={rating}
              onChange={(event) => setRating(event.target.value)}
              placeholder="93"
            />
          </Field>
          <Field label="Price per glass/bottle">
            <input
              inputMode="decimal"
              className={inputClass}
              value={pricePaid}
              onChange={(event) => setPricePaid(event.target.value)}
              placeholder="24"
            />
          </Field>
          <Field label="Worth buying?">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={buyAgain}
                onChange={(event) => setBuyAgain(event.target.checked)}
                className="size-4"
              />
              Would buy this
            </label>
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What made it good?"
          />
        </Field>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button size="lg" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : 'Save tasting'}
          </Button>
          <Button
            variant="outline"
            size="lg"
            disabled={saving}
            onClick={onDone}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
