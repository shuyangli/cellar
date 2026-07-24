import { createFileRoute, Link } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { fetchStats } from '#/lib/cellar'

export const Route = createFileRoute('/stats')({
  loader: () => fetchStats(),
  component: StatsPage,
})

function StatsPage() {
  const stats = Route.useLoaderData()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Stats</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {stats.summary.labels.bottles.toLocaleString()} bottles ·{' '}
          {stats.summary.labels.labels.toLocaleString()} labels · est. $
          {stats.summary.estimated_cost.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <BreakdownCard
          title="By type"
          rows={stats.by_type.map((row) => ({
            label: row.wine_type,
            bottles: row.bottles,
          }))}
        />
        <BreakdownCard
          title="By country"
          rows={stats.by_country.map((row) => ({
            label: row.country,
            bottles: row.bottles,
          }))}
        />
        <BreakdownCard
          title="By region"
          rows={stats.by_region.map((row) => ({
            label: row.region,
            bottles: row.bottles,
          }))}
        />
        <SpendCard spend={stats.spend_by_month} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top rated</CardTitle>
          <CardDescription>Average across all reviewers.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {stats.top_rated.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ratings yet.</p>
          ) : (
            stats.top_rated.map((wine) => (
              <div
                key={wine.id}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <Link
                  to="/wine/$wineId"
                  params={{ wineId: String(wine.id) }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {wine.producer}{' '}
                  <span className="font-normal text-muted-foreground">
                    {wine.wine_name}
                    {wine.vintage ? ` ${wine.vintage}` : ''}
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {wine.tastings} tasting{wine.tastings === 1 ? '' : 's'}
                  </span>
                  <Badge className="tabular-nums">{wine.avg_rating}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; bottles: number }>
}) {
  const max = Math.max(1, ...rows.map((row) => row.bottles))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in stock.</p>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 truncate capitalize">{row.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(row.bottles / max) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums">
                {row.bottles}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function SpendCard({
  spend,
}: {
  spend: Array<{ month: string; spend: number; bottles: number }>
}) {
  const recent = spend.slice(-12)
  const max = Math.max(1, ...recent.map((row) => row.spend))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend by month</CardTitle>
        <CardDescription>Last 12 months with purchases.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchases logged.</p>
        ) : (
          recent.map((row) => (
            <div key={row.month} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 tabular-nums">{row.month}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(row.spend / max) * 100}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right tabular-nums">
                ${row.spend.toFixed(0)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
