import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'

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
import {
  adjustInventory,
  DEFAULT_PAGE_SIZE,
  fetchCellar,
  PAGE_SIZE_OPTIONS,
  photoUrl,
  WINE_TYPE_OPTIONS,
} from '#/lib/cellar'
import type { CellarItem, CellarPayload, PageSizeOption } from '#/lib/cellar'

type CellarSearch = {
  page: number
  page_size: PageSizeOption
  q?: string
  wine_type?: string
  all?: boolean
}

export const Route = createFileRoute('/')({
  validateSearch: (raw): CellarSearch => {
    const rawPage = Number(raw.page)
    const rawSize = Number(raw.page_size)
    const page =
      Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1
    const page_size = (PAGE_SIZE_OPTIONS as ReadonlyArray<number>).includes(
      rawSize,
    )
      ? (rawSize as PageSizeOption)
      : DEFAULT_PAGE_SIZE
    const q = typeof raw.q === 'string' && raw.q ? raw.q : undefined
    const wine_type =
      typeof raw.wine_type === 'string' && raw.wine_type
        ? raw.wine_type
        : undefined
    const all = raw.all === true || raw.all === 'true' ? true : undefined
    return { page, page_size, q, wine_type, all }
  },
  loaderDeps: ({ search }) => ({
    page: search.page,
    page_size: search.page_size,
    q: search.q,
    wine_type: search.wine_type,
    all: search.all,
  }),
  loader: ({ deps }) =>
    fetchCellar(deps.page, deps.page_size, {
      q: deps.q,
      wine_type: deps.wine_type,
      in_stock: !deps.all,
    }),
  component: CellarPage,
})

function CellarPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const { summary, items, pagination } = data

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <Hero summary={summary} />
      <FilterBar search={search} />
      <InventorySection
        items={items}
        pagination={pagination}
        search={search}
        estimatedCost={summary.estimated_cost}
      />
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
        <p className="mt-1 text-sm text-muted-foreground">
          Managed by agents; reviewed by humans.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm" className="min-w-[7.5rem]">
            <CardContent className="flex flex-col gap-0.5">
              <span className="font-heading text-lg font-semibold tabular-nums">
                {stat.value.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">
                {stat.label}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function FilterBar({ search }: { search: CellarSearch }) {
  const navigate = useNavigate({ from: Route.fullPath })
  const [draft, setDraft] = useState(search.q ?? '')

  useEffect(() => {
    setDraft(search.q ?? '')
  }, [search.q])

  const apply = (overrides: Partial<CellarSearch>) => {
    navigate({
      search: {
        ...search,
        page: 1,
        q: draft || undefined,
        ...overrides,
      },
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          apply({})
        }}
      >
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search producer, wine, region, grape…"
          className="h-9 w-full min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1">
        <TypeChip
          label="all types"
          active={!search.wine_type}
          onClick={() => apply({ wine_type: undefined })}
        />
        {WINE_TYPE_OPTIONS.map((type) => (
          <TypeChip
            key={type}
            label={type}
            active={search.wine_type === type}
            onClick={() =>
              apply({ wine_type: search.wine_type === type ? undefined : type })
            }
          />
        ))}
        <TypeChip
          label={search.all ? 'showing all' : 'in stock'}
          active={Boolean(search.all)}
          onClick={() => apply({ all: search.all ? undefined : true })}
        />
      </div>
    </div>
  )
}

function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground'
          : 'rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground'
      }
    >
      {label}
    </button>
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
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Wine</TableHead>
                  <TableHead>Inventory</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Drinking window</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="px-4 text-right">Actions</TableHead>
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
            Nothing here yet.
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Tell your agent about a bottle, or clear the filters above.
          </p>
        </CardContent>
      )}
    </Card>
  )
}

function InventoryRow({ item }: { item: CellarItem }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const size = item.bottle_size_ml ?? 750
  const drinkingWindow =
    item.drinking_window_start || item.drinking_window_end
      ? `${item.drinking_window_start || 'now'} → ${item.drinking_window_end || 'open'}`
      : '—'

  const drink = (count: number) => {
    if (pending || count < 1 || count > item.quantity) return
    setPending(true)
    setError(null)
    void (async () => {
      try {
        await adjustInventory(
          item.id,
          -count,
          'drunk (marked in web UI)',
          'consume',
        )
        await router.invalidate()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setPending(false)
      }
    })()
  }

  const onDrinkAll = () => {
    if (
      !window.confirm(
        `Drink all ${item.quantity} bottles of ${item.producer} ${item.wine_name}${
          item.vintage ? ` (${item.vintage})` : ''
        }?`,
      )
    )
      return
    drink(item.quantity)
  }

  return (
    <TableRow className="align-top">
      <TableCell className="px-4 py-3 whitespace-normal">
        <div className="flex items-start gap-3">
          {item.label_photo ? (
            <img
              src={photoUrl(item.label_photo)}
              alt=""
              className="mt-0.5 h-12 w-9 shrink-0 rounded-sm border object-cover"
              loading="lazy"
            />
          ) : null}
          <div>
            <Link
              to="/wine/$wineId/"
              params={{ wineId: String(item.id) }}
              className="font-medium hover:underline"
            >
              {item.producer}
            </Link>
            <div className="text-muted-foreground">
              {item.wine_name}
              {item.vintage ? ` (${item.vintage})` : ''}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {item.wine_type ? (
                <Badge variant="outline" className="text-[10px] capitalize">
                  {item.wine_type}
                </Badge>
              ) : null}
              {item.varietal ? (
                <Badge variant="secondary" className="text-[10px]">
                  {item.varietal}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="font-medium tabular-nums">{item.quantity}</span>
        <span className="text-muted-foreground"> × {size} mL</span>
        {item.acquired_price != null ? (
          <div className="text-muted-foreground tabular-nums">
            ${item.acquired_price.toFixed(2)} each
          </div>
        ) : null}
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
      <TableCell className="whitespace-normal tabular-nums">
        {drinkingWindow}
      </TableCell>
      <TableCell className="whitespace-normal">
        {item.avg_rating != null ? (
          <Badge variant="secondary" className="tabular-nums">
            {item.avg_rating}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-4 whitespace-normal">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              disabled={pending || item.quantity < 1}
              onClick={() => drink(1)}
              title="Drink one bottle"
            >
              Drink
            </Button>
            {item.quantity > 1 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={onDrinkAll}
                title={`Drink all ${item.quantity} bottles`}
              >
                All
              </Button>
            ) : null}
          </div>
          {error ? (
            <span className="text-right text-[10px] text-destructive">
              {error}
            </span>
          ) : null}
        </div>
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
                ...search,
                page: Math.max(1, pagination.page - 1),
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
                ...search,
                page: pagination.page + 1,
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
              <Link to="/" search={{ ...search, page: 1, page_size: option }}>
                {option}
              </Link>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
