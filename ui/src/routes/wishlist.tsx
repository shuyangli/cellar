import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Card, CardContent } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { WishlistForm } from '#/components/wishlist-form'
import {
  fetchWishlist,
  formatWineTitle,
  removeWishlistEntry,
} from '#/lib/cellar'
import type { WishlistEntry } from '#/lib/cellar'

export const Route = createFileRoute('/wishlist')({
  loader: () => fetchWishlist(),
  component: WishlistPage,
})

function WishlistPage() {
  const entries = Route.useLoaderData()
  const [adding, setAdding] = useState(false)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Wishlist
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Wines we want to try — recommendations, and bottles worth hunting
            down.
          </p>
        </div>
        <Button
          variant={adding ? 'outline' : 'default'}
          size="lg"
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? 'Cancel' : 'Add a wine'}
        </Button>
      </div>

      {adding ? <WishlistForm onDone={() => setAdding(false)} /> : null}

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing on the wishlist yet — add the next thing someone recommends.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <WishlistCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function WishlistCard({ entry }: { entry: WishlistEntry }) {
  const router = useRouter()
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setRemoving(true)
    setError(null)
    try {
      await removeWishlistEntry(entry.id)
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setRemoving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/wine/$wineId/"
            params={{ wineId: String(entry.wine_id) }}
            className="font-medium hover:underline"
          >
            {formatWineTitle(entry)}
          </Link>
          {entry.quantity > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              already have {entry.quantity}
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={removing}
            onClick={() => void remove()}
          >
            {removing ? 'Removing…' : 'Remove'}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {[
            entry.recommended_by ? `via ${entry.recommended_by}` : null,
            [entry.region, entry.country].filter(Boolean).join(', '),
            entry.shop_name,
            entry.listed_price != null
              ? `$${entry.listed_price.toFixed(2)}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {entry.reason ? <p className="text-sm">{entry.reason}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
