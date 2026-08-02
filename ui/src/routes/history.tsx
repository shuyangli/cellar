import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Card, CardContent } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { RatingBadge } from '#/components/rating-badge'
import { Button } from '#/components/ui/button'
import { ExternalTastingForm } from '#/components/external-tasting-form'
import { TastingEditor } from '#/components/tasting-editor'
import { fetchTastings, formatWineTitle, updateTasting } from '#/lib/cellar'
import type { TastingWithWine } from '#/lib/cellar'

export const Route = createFileRoute('/history')({
  loader: () => fetchTastings(),
  component: HistoryPage,
})

function HistoryPage() {
  const tastings = Route.useLoaderData()
  const [logging, setLogging] = useState(false)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every bottle opened and reviewed — including wines tasted elsewhere.
          </p>
        </div>
        <Button
          variant={logging ? 'outline' : 'default'}
          size="lg"
          onClick={() => setLogging((open) => !open)}
        >
          {logging ? 'Cancel' : 'Log a tasting'}
        </Button>
      </div>

      {logging ? (
        <ExternalTastingForm onDone={() => setLogging(false)} />
      ) : null}

      {tastings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tastings yet — open something good.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tastings.map((tasting) => (
            <TastingCard key={tasting.id} tasting={tasting} />
          ))}
        </div>
      )}
    </div>
  )
}

function TastingCard({ tasting }: { tasting: TastingWithWine }) {
  const elsewhere = tasting.context_type !== 'home'
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {tasting.rating != null ? (
            <RatingBadge
              rating={tasting.rating}
              initials={tasting.user_initials}
              name={tasting.user_name}
              title={tasting.user_name ?? 'Unknown'}
            />
          ) : null}
          <Link
            to="/wine/$wineId/"
            params={{ wineId: String(tasting.wine_id) }}
            className="font-medium hover:underline"
          >
            {formatWineTitle(tasting)}
          </Link>
          {tasting.buy_again ? (
            <Badge variant="outline" className="text-[10px]">
              would buy again
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? 'Close editor' : 'Edit'}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {[
            tasting.tasted_on,
            tasting.user_name,
            elsewhere ? tasting.context_type : null,
            tasting.venue,
            [tasting.region, tasting.country].filter(Boolean).join(', '),
            tasting.price_paid != null
              ? `$${tasting.price_paid.toFixed(2)}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {tasting.tasting_notes ? (
          <p className="text-sm">{tasting.tasting_notes}</p>
        ) : null}
        {tasting.food_pairing ? (
          <p className="text-xs text-muted-foreground">
            Paired with {tasting.food_pairing}
          </p>
        ) : null}
        {editing ? (
          <TastingEditor
            tasting={tasting}
            onSave={(update) => updateTasting(tasting.id, update)}
            onSaved={() => {
              setEditing(false)
              void router.invalidate()
            }}
            onCancel={() => setEditing(false)}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
