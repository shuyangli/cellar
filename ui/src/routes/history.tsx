import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { ExternalTastingForm } from '#/components/external-tasting-form'
import { InventoryEventReviewForm } from '#/components/inventory-event-review-form'
import { RatingBadge } from '#/components/rating-badge'
import { TastingEditor } from '#/components/tasting-editor'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { WineTypeIcon } from '#/components/wine-type-icon'
import {
  fetchHistory,
  formatWineTitle,
  reviewInventoryEvent,
  updateTasting,
} from '#/lib/cellar'
import type { HistoryEntry, HistoryInventoryEvent, Tasting } from '#/lib/cellar'

export const Route = createFileRoute('/history')({
  loader: () => fetchHistory(),
  component: HistoryPage,
})

function HistoryPage() {
  const history = Route.useLoaderData()
  const [logging, setLogging] = useState(false)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every bottle added, removed, opened, and reviewed.
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

      {history.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No history yet — add a bottle or log a tasting.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((entry) => (
            <HistoryCard key={entry.key} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const router = useRouter()
  const [addingReview, setAddingReview] = useState(false)
  const event = entry.event
  const displayDate = event?.purchase_date ?? entry.sort_at.slice(0, 10)
  const location = [entry.region, entry.country].filter(Boolean).join(', ')

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {event ? <InventoryDelta event={event} /> : null}
          {!event ? <Badge variant="secondary">Review</Badge> : null}
          <WineTypeIcon
            wineType={entry.wine_type}
            className="h-7 w-5 shrink-0 text-muted-foreground"
          />
          <Link
            to="/wine/$wineId/"
            params={{ wineId: String(entry.wine_id) }}
            className="font-medium hover:underline"
          >
            {formatWineTitle(entry)}
          </Link>
          {event ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setAddingReview((value) => !value)}
            >
              {addingReview
                ? 'Cancel review'
                : entry.reviews.length > 0
                  ? 'Add another review'
                  : 'Add review'}
            </Button>
          ) : null}
        </div>

        <div className="text-xs text-muted-foreground">
          {[displayDate, event ? inventoryAction(event) : null, location]
            .filter(Boolean)
            .join(' · ')}
        </div>

        {event?.reason ? <p className="text-sm">{event.reason}</p> : null}
        {event?.purchase_vendor || event?.purchase_price_per_bottle != null ? (
          <p className="text-xs text-muted-foreground">
            {[
              event.purchase_vendor,
              event.purchase_price_per_bottle != null
                ? `${event.purchase_currency ?? 'USD'} ${event.purchase_price_per_bottle.toFixed(2)} per bottle`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}

        {entry.reviews.length > 0 ? (
          <div className="mt-1 flex flex-col gap-3 border-t pt-3">
            {entry.reviews.map((review) => (
              <HistoryReview key={review.id} review={review} />
            ))}
          </div>
        ) : event && !addingReview ? (
          <p className="text-xs text-muted-foreground">No review attached.</p>
        ) : null}

        {event && addingReview ? (
          <InventoryEventReviewForm
            eventDate={displayDate}
            onSave={(review) => reviewInventoryEvent(event.id, review)}
            onSaved={() => {
              setAddingReview(false)
              void router.invalidate()
            }}
            onCancel={() => setAddingReview(false)}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

export function InventoryDelta({ event }: { event: HistoryInventoryEvent }) {
  const value = event.delta > 0 ? `+${event.delta}` : String(event.delta)
  const tone =
    event.delta > 0
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
      : event.delta < 0
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
        : ''
  return (
    <Badge
      variant="outline"
      className={`min-w-9 justify-center tabular-nums ${tone}`}
    >
      {value}
    </Badge>
  )
}

function inventoryAction(event: HistoryInventoryEvent): string {
  const bottles = Math.abs(event.delta)
  const count = `${bottles} bottle${bottles === 1 ? '' : 's'}`
  if (event.event_type === 'purchase' || event.event_type === 'migration') {
    return `Added ${count}`
  }
  if (event.event_type === 'consume') return `Drank ${count}`
  if (event.event_type === 'gift') {
    return event.delta < 0 ? `Gifted ${count}` : `Received ${count}`
  }
  return event.delta < 0 ? `Removed ${count}` : `Added ${count}`
}

function HistoryReview({ review }: { review: Tasting }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const elsewhere = review.context_type !== 'home'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {review.rating != null ? (
          <RatingBadge
            rating={review.rating}
            initials={review.user_initials}
            name={review.user_name}
            title={review.user_name ?? 'Unknown'}
          />
        ) : null}
        <span className="text-sm font-medium">
          {review.user_name ?? 'Unassigned reviewer'}
        </span>
        {review.buy_again ? (
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
      <div className="mt-1 text-xs text-muted-foreground">
        {[
          review.tasted_on,
          elsewhere ? review.context_type : null,
          review.venue,
          review.price_paid != null ? `$${review.price_paid.toFixed(2)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {review.tasting_notes ? (
        <p className="mt-1 text-sm">{review.tasting_notes}</p>
      ) : null}
      {review.food_pairing ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Paired with {review.food_pairing}
        </p>
      ) : null}
      {editing ? (
        <TastingEditor
          tasting={review}
          onSave={(update) => updateTasting(review.id, update)}
          onSaved={() => {
            setEditing(false)
            void router.invalidate()
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}
