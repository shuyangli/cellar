import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

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
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-3 py-5 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
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
          className="shrink-0"
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
        <Card className="gap-0 overflow-hidden py-0">
          <div
            data-history-columns
            className="hidden grid-cols-[7rem_minmax(0,1fr)_10rem_8rem_2.75rem] items-center gap-x-3 border-b bg-muted/55 px-4 py-2 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase md:grid"
          >
            <span>Date</span>
            <span>Wine</span>
            <span>Activity</span>
            <span>Review</span>
            <span className="sr-only">Details</span>
          </div>
          <div className="divide-y">
            {history.map((entry) => (
              <HistoryRow key={entry.key} entry={entry} />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

export function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [addingReview, setAddingReview] = useState(false)
  const event = entry.event
  const displayDate = event?.purchase_date ?? entry.sort_at.slice(0, 10)
  const location = [entry.region, entry.country].filter(Boolean).join(', ')
  const title = formatWineTitle(entry)
  const detailsId = `history-details-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  return (
    <article
      aria-label={`${title} history entry`}
      className="overflow-hidden bg-card/35 transition-colors hover:bg-muted/20"
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-2 px-3 py-2 sm:px-4 md:grid-cols-[7rem_minmax(0,1fr)_10rem_8rem_2.75rem] md:gap-x-3">
        <time
          dateTime={displayDate}
          className="hidden text-xs tabular-nums text-muted-foreground md:row-span-2 md:block"
        >
          {displayDate}
        </time>

        <div className="col-start-1 row-span-2 min-w-0 self-center md:col-start-2">
          <div className="flex min-w-0 items-center gap-2">
            <WineTypeIcon
              wineType={entry.wine_type}
              className="h-7 w-5 shrink-0 text-muted-foreground"
            />
            <Link
              to="/wine/$wineId/"
              params={{ wineId: String(entry.wine_id) }}
              className="block min-w-0 truncate text-sm font-medium hover:underline"
            >
              {title}
            </Link>
          </div>
          <p className="mt-0.5 truncate pl-7 text-[0.7rem] text-muted-foreground md:hidden">
            {displayDate} · {event ? inventoryAction(event) : 'Tasting'}
          </p>
        </div>

        <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-1.5 self-end md:col-start-3 md:row-span-2 md:items-center md:justify-start md:self-center">
          {event ? <InventoryDelta event={event} /> : null}
          {!event ? <Badge variant="secondary">Review</Badge> : null}
          <span className="hidden truncate text-xs text-muted-foreground md:inline">
            {event ? inventoryAction(event) : 'Tasting'}
          </span>
        </div>

        <ReviewSummary
          reviews={entry.reviews}
          className="col-start-2 row-start-2 flex min-w-0 items-start justify-end self-start md:col-start-4 md:row-start-1 md:row-span-2 md:items-center md:justify-start md:self-center"
        />

        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} history entry for ${title}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
          className="col-start-3 row-span-2 row-start-1 flex size-11 items-center justify-center self-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:col-start-5"
        >
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      <div
        id={detailsId}
        hidden={!expanded}
        className="border-t bg-muted/20 px-3 py-4 text-xs sm:px-4 md:pl-[8.75rem]"
      >
        <div className="flex flex-col gap-4">
          <dl className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-muted-foreground">Date</dt>
            <dd className="tabular-nums">{displayDate}</dd>
            <dt className="text-muted-foreground">Activity</dt>
            <dd>{event ? inventoryAction(event) : 'Tasting logged'}</dd>
            {location ? (
              <>
                <dt className="text-muted-foreground">Origin</dt>
                <dd>{location}</dd>
              </>
            ) : null}
            {event?.purchase_vendor ||
            event?.purchase_price_per_bottle != null ? (
              <>
                <dt className="text-muted-foreground">Purchase</dt>
                <dd>
                  {[
                    event.purchase_vendor,
                    event.purchase_price_per_bottle != null
                      ? `${event.purchase_currency ?? 'USD'} ${event.purchase_price_per_bottle.toFixed(2)} per bottle`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </>
            ) : null}
            {event?.reason ? (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd>{event.reason}</dd>
              </>
            ) : null}
          </dl>

          {entry.reviews.length > 0 ? (
            <div className="flex flex-col gap-3 border-t pt-3">
              {entry.reviews.map((review) => (
                <HistoryReview key={review.id} review={review} />
              ))}
            </div>
          ) : event && !addingReview ? (
            <p className="border-t pt-3 text-muted-foreground">
              No review attached.
            </p>
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

          {event && !addingReview ? (
            <div className="border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                onClick={() => setAddingReview(true)}
              >
                {entry.reviews.length > 0 ? 'Add another review' : 'Add review'}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function ReviewSummary({
  reviews,
  className,
}: {
  reviews: Array<Tasting>
  className: string
}) {
  const rated = reviews.filter((review) => review.rating != null)

  return (
    <div className={`${className} items-center gap-1`}>
      {rated.slice(0, 1).map((review) => (
        <RatingBadge
          key={review.id}
          rating={review.rating!}
          initials={review.user_initials}
          name={review.user_name}
          title={review.user_name ?? 'Unknown'}
        />
      ))}
      {rated.length > 1 ? (
        <span className="text-[0.68rem] text-muted-foreground">
          +{rated.length - 1}
        </span>
      ) : null}
      {reviews.length > 0 && rated.length === 0 ? (
        <span className="text-[0.68rem] text-muted-foreground">
          {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
        </span>
      ) : null}
      {reviews.length === 0 ? (
        <span className="hidden text-[0.68rem] text-muted-foreground md:inline">
          —
        </span>
      ) : null}
    </div>
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
          className="ml-auto min-h-11 px-2 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
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
