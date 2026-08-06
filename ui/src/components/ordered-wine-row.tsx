import { ExternalLink } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { TableCell, TableRow } from '#/components/ui/table'
import { cellarPath } from '#/lib/base-path'
import type { OrderedWine } from '#/lib/cellar'

function shortDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatPrice(value: number, currency: string): string {
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${code}`
  }
}

function formatBottleSize(value: number): string {
  if (value >= 1000) {
    const liters = value / 1000
    return `${Number.isInteger(liters) ? liters.toFixed(0) : liters} L`
  }
  return `${value} mL`
}

type OrderedWinePresentationProps = {
  order: OrderedWine
  onArrive: (order: OrderedWine) => void
  pending?: boolean
  error?: string | null
}

export function OrderedWineCard({
  order,
  onArrive,
  pending = false,
  error = null,
}: OrderedWinePresentationProps) {
  const size = order.bottle_size_ml ?? 750
  const expected = shortDate(order.expected_on)
  const ordered = shortDate(order.ordered_on)
  const title = `${order.producer} ${order.wine_name}`

  return (
    <article
      aria-label={title}
      className="min-w-0 overflow-hidden border-b px-4 py-4 last:border-b-0 md:hidden"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={cellarPath(`/wine/${order.wine_id}/`)}
            className="block truncate font-medium hover:underline"
          >
            {order.producer}
          </a>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
            {order.wine_name}
            {order.vintage ? ` (${order.vintage})` : ''}
          </p>
          {[order.region, order.country].filter(Boolean).length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {[order.region, order.country].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 rounded-full border bg-background/70 px-2.5 py-1 text-sm font-medium tabular-nums">
          {order.quantity} × {formatBottleSize(size)}
        </div>
      </div>

      <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 border-y py-3 text-sm">
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Order
          </dt>
          <dd className="mt-1 min-w-0">
            <div className="font-medium">
              {order.vendor || 'Vendor pending'}
            </div>
            {order.order_reference ? (
              <div className="text-muted-foreground [overflow-wrap:anywhere]">
                #{order.order_reference}
              </div>
            ) : null}
            {ordered ? (
              <div className="text-muted-foreground">Ordered {ordered}</div>
            ) : null}
            {order.price_per_bottle != null ? (
              <div className="text-muted-foreground tabular-nums">
                {formatPrice(order.price_per_bottle, order.currency)} each
              </div>
            ) : null}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Delivery
          </dt>
          <dd className="mt-0.5 min-w-0">
            {order.tracking_url ? (
              <a
                href={order.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 max-w-full items-center gap-1 text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
              >
                <span>Track shipment</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <span className="flex min-h-11 items-center text-muted-foreground">
                Tracking pending
              </span>
            )}
            {expected ? (
              <div className="text-muted-foreground">Expected {expected}</div>
            ) : null}
          </dd>
        </div>
      </dl>

      <Button
        className="mt-3 min-h-11 w-full"
        disabled={pending}
        onClick={() => onArrive(order)}
      >
        {pending ? 'Arriving…' : 'Mark arrived'}
      </Button>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="status">
          {error}
        </p>
      ) : null}
    </article>
  )
}

export function OrderedWineRow({
  order,
  onArrive,
  pending = false,
  error = null,
}: OrderedWinePresentationProps) {
  const size = order.bottle_size_ml ?? 750
  const expected = shortDate(order.expected_on)
  const ordered = shortDate(order.ordered_on)

  return (
    <TableRow className="align-top">
      <TableCell className="px-4 py-3 whitespace-normal">
        <a
          href={cellarPath(`/wine/${order.wine_id}/`)}
          className="font-medium hover:underline"
        >
          {order.producer}
        </a>
        <div className="text-muted-foreground">
          {order.wine_name}
          {order.vintage ? ` (${order.vintage})` : ''}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {[order.region, order.country].filter(Boolean).join(' · ')}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="font-medium tabular-nums">
          {order.quantity} × {size} mL
        </span>
        {order.price_per_bottle != null ? (
          <div className="text-muted-foreground tabular-nums">
            {formatPrice(order.price_per_bottle, order.currency)} each
          </div>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-normal">
        {order.vendor || '—'}
        {order.order_reference ? (
          <div className="text-muted-foreground">#{order.order_reference}</div>
        ) : null}
        {ordered ? (
          <div className="text-muted-foreground">Ordered {ordered}</div>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-normal">
        {order.tracking_url ? (
          <a
            href={order.tracking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
          >
            Track shipment
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-muted-foreground">Tracking pending</span>
        )}
        {expected ? (
          <div className="mt-1 text-muted-foreground">Expected {expected}</div>
        ) : null}
      </TableCell>
      <TableCell className="px-4 whitespace-normal">
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" disabled={pending} onClick={() => onArrive(order)}>
            {pending ? 'Arriving…' : 'Arrived'}
          </Button>
          {error ? (
            <span className="max-w-48 text-right text-[10px] text-destructive">
              {error}
            </span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}
