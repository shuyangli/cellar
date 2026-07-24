import { createFileRoute, Link } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { fetchDrinkNow } from '#/lib/cellar'
import type { CellarItem } from '#/lib/cellar'

export const Route = createFileRoute('/drink-now')({
  loader: () => fetchDrinkNow(),
  component: DrinkNowPage,
})

function DrinkNowPage() {
  const data = Route.useLoaderData()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Drink now
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drinking windows vs. {data.year}.
        </p>
      </div>

      <WindowSection
        title="Past peak"
        description="Probably fading — open these first, adjust expectations."
        items={data.past_peak}
        tone="destructive"
      />
      <WindowSection
        title="In the window"
        description="Ready to drink. Bottles whose window closes within a year are flagged."
        items={data.ready}
        tone="default"
      />
      <WindowSection
        title="Approaching"
        description="Still improving — hold."
        items={data.approaching}
        tone="secondary"
      />
      <WindowSection
        title="No window set"
        description="Ask your agent to research drinking windows for these."
        items={data.no_window}
        tone="outline"
      />
    </div>
  )
}

function WindowSection({
  title,
  description,
  items,
  tone,
}: {
  title: string
  description: string
  items: Array<CellarItem & { closing_soon?: boolean }>
  tone: 'default' | 'secondary' | 'destructive' | 'outline'
}) {
  if (items.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          <Badge variant={tone} className="tabular-nums">
            {items.length}
          </Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <Link
                to="/wine/$wineId/"
                params={{ wineId: String(item.id) }}
                className="font-medium hover:underline"
              >
                {item.producer}{' '}
                <span className="font-normal text-muted-foreground">
                  {item.wine_name}
                  {item.vintage ? ` ${item.vintage}` : ''}
                </span>
              </Link>
              <div className="text-xs text-muted-foreground">
                {[item.region, item.wine_type].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.closing_soon ? (
                <Badge variant="destructive" className="text-[10px]">
                  closing soon
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground tabular-nums">
                {item.drinking_window_start || '…'}–{item.drinking_window_end || '…'}
              </span>
              <Badge variant="secondary" className="tabular-nums">
                ×{item.quantity}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
