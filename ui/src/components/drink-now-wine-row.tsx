import { Link } from '@tanstack/react-router'

import { Badge } from '#/components/ui/badge'
import { DrinkingWindow } from '#/components/drinking-window'
import { WineTypeIcon } from '#/components/wine-type-icon'
import type { CellarItem } from '#/lib/cellar'

export function DrinkNowWineRow({
  item,
  year,
}: {
  item: CellarItem
  year: number
}) {
  const bottleLabel = `${item.quantity} ${item.quantity === 1 ? 'bottle' : 'bottles'}`

  return (
    <div
      data-testid="drink-now-wine-row"
      className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 py-2.5 first:pt-0 last:pb-0 sm:gap-3"
    >
      <WineTypeIcon
        wineType={item.wine_type}
        className="h-8 w-6 shrink-0 text-muted-foreground"
      />
      <Badge
        data-slot="bottle-count"
        variant="secondary"
        className="tabular-nums"
        aria-label={bottleLabel}
      >
        ×{item.quantity}
      </Badge>
      <div data-slot="wine-details" className="min-w-0">
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
      <div data-slot="drinking-window" className="shrink-0">
        <DrinkingWindow
          start={item.drinking_window_start}
          end={item.drinking_window_end}
          year={year}
          className="text-right text-xs"
        />
      </div>
    </div>
  )
}
