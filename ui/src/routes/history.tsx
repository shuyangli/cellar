import { createFileRoute, Link } from '@tanstack/react-router'

import { Card, CardContent } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { fetchTastings, formatWineTitle } from '#/lib/cellar'

export const Route = createFileRoute('/history')({
  loader: () => fetchTastings(),
  component: HistoryPage,
})

function HistoryPage() {
  const tastings = Route.useLoaderData()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          History
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every bottle opened and reviewed.
        </p>
      </div>

      {tastings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tastings yet — open something good.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tastings.map((tasting) => (
            <Card key={tasting.id}>
              <CardContent className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {tasting.rating != null ? (
                    <Badge className="tabular-nums">{tasting.rating}</Badge>
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
                </div>
                <div className="text-xs text-muted-foreground">
                  {[
                    tasting.tasted_on,
                    tasting.user_name,
                    tasting.context_type !== 'home' ? tasting.context_type : null,
                    tasting.venue,
                    [tasting.region, tasting.country].filter(Boolean).join(', '),
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
