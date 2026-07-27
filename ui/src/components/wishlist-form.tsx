import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Card, CardContent } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  fetchCellar,
  formatWineTitle,
  parseWishlistInput,
  saveWishlistEntry,
  WINE_TYPE_OPTIONS,
} from '#/lib/cellar'
import type { CellarItem } from '#/lib/cellar'

const inputClass =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Adds a wine we want to try. The wine may already be on file — we may even own
 * it — so matching against an existing row keeps the entry attached to that
 * wine's history instead of forking a duplicate.
 */
export function WishlistForm({ onDone }: { onDone: () => void }) {
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

  const [recommendedBy, setRecommendedBy] = useState('')
  const [reason, setReason] = useState('')
  const [shopName, setShopName] = useState('')
  const [listedPrice, setListedPrice] = useState('')

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

  const submit = async () => {
    setError(null)
    const parsed = parseWishlistInput({
      matchedWineId: matched?.id ?? null,
      producer,
      wine_name: wineName,
      vintage,
      wine_type: wineType,
      region,
      country,
      recommended_by: recommendedBy,
      reason,
      shop_name: shopName,
      listed_price: listedPrice,
    })
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    setSaving(true)
    try {
      await saveWishlistEntry(parsed.value)
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
            Add to the wishlist
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Records a wine to try later without adding any bottles to inventory.
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
                          onClick={() => {
                            setMatched(item)
                            setResults(null)
                            setQuery('')
                          }}
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
          <Field label="Recommended by">
            <input
              className={inputClass}
              value={recommendedBy}
              onChange={(event) => setRecommendedBy(event.target.value)}
              placeholder="Who suggested it?"
            />
          </Field>
          <Field label="Seen at (optional)">
            <input
              className={inputClass}
              value={shopName}
              onChange={(event) => setShopName(event.target.value)}
              placeholder="Shop or importer"
            />
          </Field>
          <Field label="Listed price (optional)">
            <input
              inputMode="decimal"
              className={inputClass}
              value={listedPrice}
              onChange={(event) => setListedPrice(event.target.value)}
              placeholder="45"
            />
          </Field>
        </div>

        <Field label="Why">
          <textarea
            className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What did they say about it?"
          />
        </Field>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button size="lg" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : 'Add to wishlist'}
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
