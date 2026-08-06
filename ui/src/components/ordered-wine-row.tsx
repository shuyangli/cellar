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

export function OrderedWineRow({
  order,
  onArrive,
  pending = false,
  error = null,
}: {
  order: OrderedWine
  onArrive: (order: OrderedWine) => void
  pending?: boolean
  error?: string | null
}) {
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
