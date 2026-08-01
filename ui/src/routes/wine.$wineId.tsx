import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Badge } from '#/components/ui/badge'
import { RatingBadge, RatingBadges } from '#/components/rating-badge'
import { Button } from '#/components/ui/button'
import {
  adjustInventory,
  DEFAULT_CELLAR_SEARCH,
  deletePurchase,
  deleteTasting,
  deleteWine,
  fetchWine,
  photoUrl,
  updateWine,
  WINE_TYPE_OPTIONS,
} from '#/lib/cellar'
import type { Purchase, Tasting, WineDossier, WineUpdate } from '#/lib/cellar'

export const Route = createFileRoute('/wine/$wineId')({
  loader: ({ params }) => fetchWine(params.wineId),
  component: WinePage,
})

function WinePage() {
  const wine = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => router.invalidate()

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onAdjust = (delta: number) => {
    const reason = window.prompt(
      delta > 0
        ? 'Reason for adding a bottle?'
        : 'Reason for removing a bottle?',
      delta > 0 ? 'manual correction' : 'manual correction',
    )
    if (reason === null) return
    void run(() => adjustInventory(wine.id, delta, reason))
  }

  const onMarkDrunk = () => {
    const answer = window.prompt(
      `How many bottles did you drink? (${wine.quantity} in cellar)`,
      '1',
    )
    if (answer === null) return
    const count = Number(answer.trim())
    if (!Number.isInteger(count) || count < 1 || count > wine.quantity) {
      setError(
        `Enter a whole number between 1 and ${wine.quantity} bottle${wine.quantity === 1 ? '' : 's'}.`,
      )
      return
    }
    void run(() =>
      adjustInventory(wine.id, -count, 'drunk (marked in web UI)', 'consume'),
    )
  }

  const onDeleteWine = () => {
    if (
      !window.confirm(
        `Delete "${wine.producer} ${wine.wine_name}" and ALL its purchases, tastings, and photos? This cannot be undone.`,
      )
    )
      return
    void (async () => {
      setError(null)
      try {
        await deleteWine(wine.id)
        await navigate({ to: '/', search: DEFAULT_CELLAR_SEARCH })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <Link
          to="/"
          search={DEFAULT_CELLAR_SEARCH}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to cellar
        </Link>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              {wine.producer}
            </h1>
            <p className="text-lg text-muted-foreground">
              {wine.wine_name}
              {wine.vintage ? ` · ${wine.vintage}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {wine.wine_type ? (
                <Badge variant="outline" className="capitalize">
                  {wine.wine_type}
                </Badge>
              ) : null}
              {wine.varietal ? (
                <Badge variant="secondary">{wine.varietal}</Badge>
              ) : null}
              <RatingBadges ratings={wine.ratings} />
              {wine.ratings.length > 1 && wine.avg_rating != null ? (
                <Badge variant="outline" className="tabular-nums">
                  {wine.avg_rating} avg
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="font-heading text-3xl font-semibold tabular-nums">
              {wine.quantity}
            </div>
            <div className="text-xs text-muted-foreground">
              bottle{wine.quantity === 1 ? '' : 's'} in cellar
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={wine.quantity < 1} onClick={onMarkDrunk}>
            Mark drunk
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAdjust(1)}>
            +1 bottle
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={wine.quantity < 1}
            onClick={() => onAdjust(-1)}
          >
            −1 bottle
          </Button>
          <Button
            variant={editing ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? 'Close editor' : 'Edit details'}
          </Button>
          <Button variant="destructive" size="sm" onClick={onDeleteWine}>
            Delete wine
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        ) : null}
      </div>

      {editing ? (
        <EditCard
          wine={wine}
          onSaved={() => {
            setEditing(false)
            void refresh()
          }}
          onError={setError}
        />
      ) : null}
      <FactsCard wine={wine} />
      {wine.photos.length > 0 ? <PhotosCard wine={wine} /> : null}
      <TastingsCard tastings={wine.tastings} onMutate={run} />
      <PurchasesCard purchases={wine.purchases} onMutate={run} />
      <EventsCard wine={wine} />
    </div>
  )
}

const EDIT_FIELDS: Array<{
  key: keyof WineUpdate
  label: string
  type?: 'number' | 'select'
  span?: boolean
}> = [
  { key: 'producer', label: 'Producer' },
  { key: 'wine_name', label: 'Wine name' },
  { key: 'vintage', label: 'Vintage' },
  { key: 'wine_type', label: 'Type', type: 'select' },
  { key: 'country', label: 'Country' },
  { key: 'region', label: 'Region' },
  { key: 'appellation', label: 'Appellation' },
  { key: 'varietal', label: 'Varietal' },
  { key: 'grapes', label: 'Grapes / blend' },
  { key: 'bottle_size_ml', label: 'Bottle size (mL)', type: 'number' },
  { key: 'drinking_window_start', label: 'Drink from (year)' },
  { key: 'drinking_window_end', label: 'Drink until (year)' },
  { key: 'location', label: 'Location' },
  { key: 'notes', label: 'Notes', span: true },
]

function EditCard({
  wine,
  onSaved,
  onError,
}: {
  wine: WineDossier
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      EDIT_FIELDS.map((field) => [
        field.key,
        wine[field.key as keyof WineDossier] != null
          ? String(wine[field.key as keyof WineDossier])
          : '',
      ]),
    ),
  )
  const [saving, setSaving] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const fields: WineUpdate = {}
      for (const field of EDIT_FIELDS) {
        const value = draft[field.key].trim()
        const original = wine[field.key as keyof WineDossier]
        const originalText = original != null ? String(original) : ''
        if (value === originalText) continue
        if (field.type === 'number') {
          const parsed = Number(value)
          if (Number.isFinite(parsed) && parsed > 0) {
            fields[field.key] = parsed as never
          }
        } else {
          fields[field.key] = value as never
        }
      }
      if (Object.keys(fields).length === 0) {
        onSaved()
        return
      }
      await updateWine(wine.id, fields)
      onSaved()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit details</CardTitle>
        <CardDescription>
          Leave a field unchanged to keep its current value.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {EDIT_FIELDS.map((field) => (
            <label
              key={field.key}
              className={`flex flex-col gap-1 ${field.span ? 'sm:col-span-2' : ''}`}
            >
              <span className="text-xs text-muted-foreground">
                {field.label}
              </span>
              {field.type === 'select' ? (
                <select
                  className={inputClass}
                  value={draft[field.key] ?? ''}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      [field.key]: event.target.value,
                    }))
                  }
                >
                  <option value="">—</option>
                  {WINE_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.span ? (
                <textarea
                  className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={draft[field.key] ?? ''}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  className={inputClass}
                  value={draft[field.key] ?? ''}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              )}
            </label>
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

function FactsCard({ wine }: { wine: WineDossier }) {
  const drinkingWindow =
    wine.drinking_window_start || wine.drinking_window_end
      ? `${wine.drinking_window_start || 'now'} → ${wine.drinking_window_end || 'open'}`
      : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label="Country" value={wine.country} />
          <Fact label="Region" value={wine.region} />
          <Fact label="Appellation" value={wine.appellation} />
          <Fact label="Grapes" value={wine.grapes || wine.varietal} />
          <Fact
            label="Bottle size"
            value={wine.bottle_size_ml ? `${wine.bottle_size_ml} mL` : null}
          />
          <Fact label="Drinking window" value={drinkingWindow} />
          <Fact label="Location" value={wine.location} />
          <Fact
            label="Last paid"
            value={
              wine.acquired_price != null
                ? `$${wine.acquired_price.toFixed(2)}`
                : null
            }
          />
          <Fact label="Last vendor" value={wine.acquired_from} />
        </dl>
        {wine.notes ? (
          <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">
            {wine.notes}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PhotosCard({ wine }: { wine: WineDossier }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {wine.photos.map((photo) => (
          <a
            key={photo.id}
            href={photoUrl(photo.path)}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={photoUrl(photo.path)}
              alt={photo.kind}
              className="h-40 rounded-md border object-cover"
              loading="lazy"
            />
          </a>
        ))}
      </CardContent>
    </Card>
  )
}

function TastingsCard({
  tastings,
  onMutate,
}: {
  tastings: Array<Tasting>
  onMutate: (action: () => Promise<unknown>) => Promise<void>
}) {
  const onDelete = (tasting: Tasting) => {
    if (
      !window.confirm(
        'Delete this tasting? Any bottle it consumed will be returned to inventory.',
      )
    )
      return
    void onMutate(() => deleteTasting(tasting.id))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tastings & reviews</CardTitle>
        <CardDescription>
          {tastings.length === 0
            ? 'Not tasted yet.'
            : `${tastings.length} tasting${tastings.length === 1 ? '' : 's'} logged`}
        </CardDescription>
      </CardHeader>
      {tastings.length > 0 ? (
        <CardContent className="flex flex-col gap-4">
          {[...tastings].reverse().map((tasting) => (
            <div key={tasting.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {tasting.rating != null ? (
                  <RatingBadge
                    rating={tasting.rating}
                    initials={tasting.user_initials}
                    name={tasting.user_name}
                    title={tasting.user_name ?? 'Unknown'}
                  />
                ) : null}
                <span className="text-sm font-medium">
                  {tasting.user_name ?? 'Unknown'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {tasting.tasted_on ?? ''}
                  {tasting.context_type && tasting.context_type !== 'home'
                    ? ` · ${tasting.context_type}`
                    : ''}
                  {tasting.venue ? ` · ${tasting.venue}` : ''}
                </span>
                {tasting.buy_again ? (
                  <Badge variant="outline" className="text-[10px]">
                    would buy again
                  </Badge>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(tasting)}
                >
                  Delete
                </Button>
              </div>
              {tasting.tasting_notes ? (
                <p className="mt-2 text-sm">{tasting.tasting_notes}</p>
              ) : null}
              {tasting.food_pairing ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Paired with {tasting.food_pairing}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  )
}

function PurchasesCard({
  purchases,
  onMutate,
}: {
  purchases: Array<Purchase>
  onMutate: (action: () => Promise<unknown>) => Promise<void>
}) {
  const onDelete = (purchase: Purchase) => {
    if (
      !window.confirm(
        `Delete this purchase of ${purchase.quantity} bottle${purchase.quantity === 1 ? '' : 's'}? Its bottles are removed from inventory.`,
      )
    )
      return
    void onMutate(() => deletePurchase(purchase.id))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchases</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        {purchases.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Date</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="px-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell className="px-4 tabular-nums">
                    {purchase.purchase_date ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {purchase.quantity}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {purchase.price_per_bottle != null
                      ? `$${purchase.price_per_bottle.toFixed(2)}`
                      : '—'}
                  </TableCell>
                  <TableCell>{purchase.vendor ?? '—'}</TableCell>
                  <TableCell>{purchase.source}</TableCell>
                  <TableCell className="px-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(purchase)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-6 pb-2 text-sm text-muted-foreground">
            No purchases recorded.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function EventsCard({ wine }: { wine: WineDossier }) {
  if (wine.events.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory history</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {[...wine.events].reverse().map((event) => (
          <div key={event.id} className="flex items-baseline gap-2 text-sm">
            <span className="w-14 shrink-0 text-right font-medium tabular-nums">
              {event.delta > 0 ? `+${event.delta}` : event.delta}
            </span>
            <span className="text-muted-foreground">
              {event.reason ?? event.event_type}
              <span className="ml-2 text-xs opacity-70">
                {event.occurred_at.slice(0, 10)}
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
