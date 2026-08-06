import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'

import { OrderedWineRow } from '#/components/ordered-wine-row'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { adjustInventoryAndRefresh } from '#/lib/inventory-view'
import { fetchOrderedWines, markOrderedWineArrived } from '#/lib/cellar'
import type { OrderedWine } from '#/lib/cellar'

export const Route = createFileRoute('/ordered')({
  loader: () => fetchOrderedWines(),
  component: OrderedWinesPage,
})

function OrderedWinesPage() {
  const orders = Route.useLoaderData()
  const router = useRouter()
  const pendingRef = useRef(new Set<number>())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map())

  const arrive = useCallback(
    (order: OrderedWine) => {
      if (pendingRef.current.has(order.id)) return
      pendingRef.current.add(order.id)
      setPendingIds(new Set(pendingRef.current))
      setErrors((current) => {
        const next = new Map(current)
        next.delete(order.id)
        return next
      })

      void (async () => {
        const outcome = await adjustInventoryAndRefresh(
          () => markOrderedWineArrived(order.id),
          () => router.invalidate(),
        )
        if (outcome.kind === 'mutation_failed') {
          pendingRef.current.delete(order.id)
          setPendingIds(new Set(pendingRef.current))
          setErrors((current) =>
            new Map(current).set(order.id, outcome.message),
          )
        } else if (outcome.kind === 'refreshed') {
          pendingRef.current.delete(order.id)
          setPendingIds(new Set(pendingRef.current))
        } else {
          setErrors((current) =>
            new Map(current).set(
              order.id,
              'Inventory updated, but this list could not refresh. Reload before trying again.',
            ),
          )
          // Keep the row disabled: the arrival succeeded and retrying from stale
          // UI would be misleading, even though the API itself is idempotent.
        }
      })()
    },
    [router],
  )

  const bottles = orders.reduce((sum, order) => sum + order.quantity, 0)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-7 sm:px-6 sm:py-10">
      <div>
        <p className="cellar-kicker text-[0.68rem] font-semibold text-primary/75 uppercase">
          In transit
        </p>
        <h1 className="font-heading mt-1 text-4xl font-semibold tracking-tight">
          Ordered wines
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {bottles === 0
            ? 'No bottles are currently on the way.'
            : `${bottles} ${bottles === 1 ? 'bottle' : 'bottles'} across ${orders.length} ${orders.length === 1 ? 'order line' : 'order lines'}.`}
        </p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Awaiting arrival</CardTitle>
        </CardHeader>
        {orders.length === 0 ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Forward an order or tracking email to your agent and ask for it to
            be added here.
          </CardContent>
        ) : (
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Wine</TableHead>
                  <TableHead>Bottles</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead className="px-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <OrderedWineRow
                    key={order.id}
                    order={order}
                    pending={pendingIds.has(order.id)}
                    error={errors.get(order.id)}
                    onArrive={arrive}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
