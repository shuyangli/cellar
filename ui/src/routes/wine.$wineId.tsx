import { createFileRoute, Link } from '@tanstack/react-router'

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
import { fetchWine, formatWineTitle, photoUrl } from '#/lib/cellar'
import type { Purchase, Tasting, WineDossier } from '#/lib/cellar'

export const Route = createFileRoute('/wine/$wineId')({
  loader: ({ params }) => fetchWine(params.wineId),
  component: WinePage,
})

function WinePage() {
  const wine = Route.useLoaderData()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <Link
          to="/"
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
              {wine.varietal ? <Badge variant="secondary">{wine.varietal}</Badge> : null}
              {wine.avg_rating != null ? (
                <Badge className="tabular-nums">{wine.avg_rating} avg</Badge>
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
      </div>

      <FactsCard wine={wine} />
      {wine.photos.length > 0 ? <PhotosCard wine={wine} /> : null}
      <TastingsCard tastings={wine.tastings} />
      <PurchasesCard purchases={wine.purchases} />
      <EventsCard wine={wine} />
    </div>
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
          <Fact label="Bottle size" value={wine.bottle_size_ml ? `${wine.bottle_size_ml} mL` : null} />
          <Fact label="Drinking window" value={drinkingWindow} />
          <Fact label="Location" value={wine.location} />
          <Fact
            label="Last paid"
            value={wine.acquired_price != null ? `$${wine.acquired_price.toFixed(2)}` : null}
          />
          <Fact label="Last vendor" value={wine.acquired_from} />
        </dl>
        {wine.notes ? (
          <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">{wine.notes}</p>
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
          <a key={photo.id} href={photoUrl(photo.path)} target="_blank" rel="noreferrer">
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

function TastingsCard({ tastings }: { tastings: Array<Tasting> }) {
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
                  <Badge className="tabular-nums">{tasting.rating}</Badge>
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

function PurchasesCard({ purchases }: { purchases: Array<Purchase> }) {
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
                <TableHead className="px-4">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell className="px-4 tabular-nums">
                    {purchase.purchase_date ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">{purchase.quantity}</TableCell>
                  <TableCell className="tabular-nums">
                    {purchase.price_per_bottle != null
                      ? `$${purchase.price_per_bottle.toFixed(2)}`
                      : '—'}
                  </TableCell>
                  <TableCell>{purchase.vendor ?? '—'}</TableCell>
                  <TableCell className="px-4">{purchase.source}</TableCell>
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
                {event.occurred_at?.slice(0, 10)}
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
