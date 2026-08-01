import { createFileRoute } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { DrinkNowWineRow } from '#/components/drink-now-wine-row'
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
        year={data.year}
        tone="destructive"
      />
      <WindowSection
        title="Drink first"
        description="In their window with a year or less left — prioritize these."
        items={data.drink_first}
        year={data.year}
        tone="destructive"
      />
      <WindowSection
        title="Drink soon"
        description="Ready now with two to three years left in the window."
        items={data.drink_soon}
        year={data.year}
        tone="default"
      />
      <WindowSection
        title="Ready, can hold"
        description="Good to open, but still worth aging — four to seven years remain, or the window is open-ended."
        items={data.ready_to_hold}
        year={data.year}
        tone="secondary"
      />
      <WindowSection
        title="Long-term potential"
        description="Drinkable, but the window runs eight or more years — aging may add meaningful complexity."
        items={data.long_term}
        year={data.year}
        tone="outline"
      />
      <WindowSection
        title="Hold"
        description="The drinking window has not opened yet."
        items={data.approaching}
        year={data.year}
        tone="secondary"
      />
      <WindowSection
        title="No window set"
        description="Ask your agent to research drinking windows for these."
        items={data.no_window}
        year={data.year}
        tone="outline"
      />
    </div>
  )
}

function WindowSection({
  title,
  description,
  items,
  year,
  tone,
}: {
  title: string
  description: string
  items: Array<CellarItem>
  year: number
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
          <DrinkNowWineRow key={item.id} item={item} year={year} />
        ))}
      </CardContent>
    </Card>
  )
}
