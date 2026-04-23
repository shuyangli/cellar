import { createFileRoute, Link } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { fetchCellar, PAGE_SIZE_OPTIONS } from '#/lib/cellar'
import type {
  CellarItem,
  CellarPayload,
  PageSizeOption,
} from '#/lib/cellar'

type CellarSearch = {
  page: number
  page_size: PageSizeOption
}

const DEFAULT_PAGE_SIZE: PageSizeOption = 25

export const Route = createFileRoute('/')({
  validateSearch: (raw): CellarSearch => {
    const rawPage = Number((raw).page)
    const rawSize = Number((raw).page_size)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1
    const page_size = (PAGE_SIZE_OPTIONS as ReadonlyArray<number>).includes(
      rawSize,
    )
      ? (rawSize as PageSizeOption)
      : DEFAULT_PAGE_SIZE
    return { page, page_size }
  },
  loaderDeps: ({ search }) => ({ page: search.page, page_size: search.page_size }),
  loader: ({ deps }) => fetchCellar(deps.page, deps.page_size),
  component: CellarPage,
})

function CellarPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const { summary, items, pagination } = data

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Hero summary={summary} />
        <InventorySection
          items={items}
          pagination={pagination}
          search={search}
          estimatedCost={summary.estimated_cost}
        />
      </div>
    </div>
  )
}

function Hero({ summary }: { summary: CellarPayload['summary'] }) {
  const stats: Array<{ label: string; value: number }> = [
    { label: 'bottles', value: summary.labels.bottles },
    { label: 'labels', value: summary.labels.labels },
    { label: 'producers', value: summary.labels.producers },
    { label: 'regions', value: summary.labels.regions },
  ]

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Private cellar view
        </p>
        <h1 className="font-heading mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
          Cellar
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Inventory only.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm" className="min-w-[7.5rem]">
            <CardContent className="flex flex-col gap-0.5">
              <span className="font-heading text-lg font-semibold tabular-nums">
                {stat.value.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function InventorySection({
  items,
  pagination,
  search,
  estimatedCost,
}: {
  items: Array<CellarItem>
  pagination: CellarPayload['pagination']
  search: CellarSearch
  estimatedCost: number
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>What's in the cellar</CardTitle>
        <CardDescription>
          Estimated acquisition cost:{' '}
          <span className="tabular-nums">${estimatedCost.toFixed(2)}</span>
        </CardDescription>
        <div className="col-start-2 row-start-1 row-span-2 self-start justify-self-end text-xs text-muted-foreground">
          Page {pagination.page} of {pagination.total_pages}
          <span className="mx-2 opacity-60">•</span>
          {pagination.total_items.toLocaleString()} labels total
        </div>
      </CardHeader>
      {items.length > 0 ? (
        <>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Wine</TableHead>
                  <TableHead>Inventory</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Drinking window</TableHead>
                  <TableHead className="px-4">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <InventoryRow key={item.id} item={item} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
          <PaginationFooter pagination={pagination} search={search} />
        </>
      ) : (
        <CardContent className="py-10 text-center">
            <h3 className="font-heading text-base font-medium">
              No bottles logged yet.
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The cellar view will fill up as bottles are added.
            </p>
        </CardContent>
      )}
    </Card>
  )
}

function InventoryRow({ item }: { item: CellarItem }) {
  const size = item.bottle_size_ml ?? 750
  const drinkingWindow =
    item.drinking_window_start || item.drinking_window_end
      ? `${item.drinking_window_start || 'now'} → ${item.drinking_window_end || 'open'}`
      : '—'

  return (
    <TableRow className="align-top">
      <TableCell className="px-4 py-3 whitespace-normal">
        <div className="font-medium">{item.producer}</div>
        <div className="text-muted-foreground">
          {item.wine_name}
          {item.vintage ? ` (${item.vintage})` : ''}
        </div>
        {item.varietal ? (
          <div className="mt-1">
            <Badge variant="secondary" className="text-[10px]">
              {item.varietal}
            </Badge>
          </div>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="font-medium tabular-nums">{item.quantity}</span>
        <span className="text-muted-foreground"> × {size} mL</span>
        {item.acquired_price != null ? (
          <div className="text-muted-foreground tabular-nums">
            ${item.acquired_price.toFixed(2)} each
          </div>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-normal">
        {item.location || '—'}
        {item.acquired_from ? (
          <div className="text-muted-foreground">from {item.acquired_from}</div>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-normal">
        {item.country || '—'}
        {item.region ? (
          <div className="text-muted-foreground">{item.region}</div>
        ) : null}
        {item.appellation ? (
          <div className="text-muted-foreground">{item.appellation}</div>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-normal tabular-nums">{drinkingWindow}</TableCell>
      <TableCell className="px-4 whitespace-normal">
        {item.notes ? <div>{item.notes}</div> : null}
        {item.last_event_reason ? (
          <div className="text-muted-foreground">
            last update: {item.last_event_reason}
          </div>
        ) : null}
        {!item.notes && !item.last_event_reason ? (
          <span className="text-muted-foreground">—</span>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function PaginationFooter({
  pagination,
  search,
}: {
  pagination: CellarPayload['pagination']
  search: CellarSearch
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 pt-4">
      <div className="flex items-center gap-2">
        <Button
          asChild={pagination.has_prev}
          variant="outline"
          size="sm"
          disabled={!pagination.has_prev}
        >
          {pagination.has_prev ? (
            <Link
              to="/"
              search={{
                page: Math.max(1, pagination.page - 1),
                page_size: search.page_size,
              }}
            >
              Previous
            </Link>
          ) : (
            <span>Previous</span>
          )}
        </Button>
        <Button
          asChild={pagination.has_next}
          variant="outline"
          size="sm"
          disabled={!pagination.has_next}
        >
          {pagination.has_next ? (
            <Link
              to="/"
              search={{
                page: pagination.page + 1,
                page_size: search.page_size,
              }}
            >
              Next
            </Link>
          ) : (
            <span>Next</span>
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Show:</span>
        {PAGE_SIZE_OPTIONS.map((option) => {
          const isCurrent = option === pagination.page_size
          if (isCurrent) {
            return (
              <Badge key={option} variant="secondary" className="tabular-nums">
                {option}
              </Badge>
            )
          }
          return (
            <Button
              key={option}
              asChild
              variant="ghost"
              size="sm"
              className="h-7 px-2 tabular-nums"
            >
              <Link to="/" search={{ page: 1, page_size: option }}>
                {option}
              </Link>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
