import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'

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
import { RatingBadges } from '#/components/rating-badge'
import { WineTypeIcon } from '#/components/wine-type-icon'
import { DrinkingWindow } from '#/components/drinking-window'
import {
  adjustInventoryAndRefresh,
  mobileWineSummary,
} from '#/lib/inventory-view'
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
    <div className="mx-auto flex max-w-6xl flex-col gap-7 px-4 py-7 sm:px-6 sm:py-10">
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
    <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="cellar-kicker text-[0.68rem] font-semibold text-[#d66e96] uppercase">
          Private cellar view
        </p>
        <h1 className="font-heading mt-1.5 bg-[linear-gradient(110deg,#f8f4f6_8%,#e9c3d0_52%,#be4a75)] bg-clip-text text-5xl font-medium tracking-[-0.025em] text-transparent md:text-6xl">
          Cellar
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Managed by agents; reviewed by humans.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            size="sm"
            className="min-w-[7.5rem] bg-card/72 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_18px_44px_rgb(88_17_50/0.22)]"
          >
            <CardContent className="flex flex-col gap-0.5">
              <span className="font-heading text-2xl font-medium tracking-[-0.01em] tabular-nums">
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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-card/55 p-2.5 shadow-[0_12px_36px_rgb(0_0_0/0.16)] backdrop-blur-xl">
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
          className="h-9 w-full min-w-0 flex-1 rounded-lg border bg-card/90 px-3 text-sm shadow-inner shadow-black/[0.015] outline-none placeholder:text-muted-foreground/75 focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="min-h-11 px-3 text-sm sm:min-h-0 sm:px-2 sm:text-xs/relaxed"
        >
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

export function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  const touchTarget =
    'inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs'

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? `${touchTarget} bg-primary font-medium text-primary-foreground`
          : `${touchTarget} border text-muted-foreground transition-colors hover:text-foreground`
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
  const drinkControls = useDrinkControls()

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
            <div className="divide-y md:hidden">
              {items.map((item) => (
                <MobileInventoryRow
                  key={item.id}
                  item={item}
                  drinkControls={drinkControls}
                />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
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
                    <InventoryRow
                      key={item.id}
                      item={item}
                      drinkControls={drinkControls}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
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

type DrinkControls = {
  drink: (item: CellarItem, count: number) => void
  drinkAll: (item: CellarItem) => void
  errors: ReadonlyMap<number, string>
  pendingIds: ReadonlySet<number>
}

function useDrinkControls(): DrinkControls {
  const router = useRouter()
  const pendingIdsRef = useRef(new Set<number>())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map())

  const drink = useCallback(
    (item: CellarItem, count: number) => {
      if (
        pendingIdsRef.current.has(item.id) ||
        count < 1 ||
        count > item.quantity
      )
        return
      pendingIdsRef.current.add(item.id)
      setPendingIds(new Set(pendingIdsRef.current))
      setErrors((current) => {
        const next = new Map(current)
        next.delete(item.id)
        return next
      })
      void (async () => {
        const clearPending = () => {
          pendingIdsRef.current.delete(item.id)
          setPendingIds(new Set(pendingIdsRef.current))
        }
        const outcome = await adjustInventoryAndRefresh(
          () =>
            adjustInventory(
              item.id,
              -count,
              'drunk (marked in web UI)',
              'consume',
            ),
          () => router.invalidate(),
        )

        if (outcome.kind === 'mutation_failed') {
          setErrors((current) => new Map(current).set(item.id, outcome.message))
          clearPending()
        } else if (outcome.kind === 'refreshed') {
          clearPending()
        } else {
          setErrors((current) =>
            new Map(current).set(
              item.id,
              'Bottle count updated, but the list could not refresh. Reload this page before making another change.',
            ),
          )
          // Keep this wine disabled while its displayed quantity may be stale.
        }
      })()
    },
    [router],
  )

  const drinkAll = useCallback(
    (item: CellarItem) => {
      if (
        !window.confirm(
          `Drink all ${item.quantity} bottles of ${item.producer} ${item.wine_name}${
            item.vintage ? ` (${item.vintage})` : ''
          }?`,
        )
      )
        return
      drink(item, item.quantity)
    },
    [drink],
  )

  return { drink, drinkAll, errors, pendingIds }
}

function MobileInventoryRow({
  item,
  drinkControls,
}: {
  item: CellarItem
  drinkControls: DrinkControls
}) {
  const [expanded, setExpanded] = useState(false)
  const { drink, drinkAll, errors, pendingIds } = drinkControls
  const error = errors.get(item.id)
  const pending = pendingIds.has(item.id)
  const size = item.bottle_size_ml ?? 750
  const summary = mobileWineSummary(item)
  const origin = [item.country, item.region, item.appellation]
    .filter(Boolean)
    .join(' · ')
  return (
    <article className="px-4 py-3">
      <div className="flex min-h-12 items-center gap-3">
        <WineTypeIcon
          wineType={item.wine_type}
          className="h-9 w-7 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <Link
            to="/wine/$wineId/"
            params={{ wineId: String(item.id) }}
            className="block truncate text-sm font-medium hover:underline"
          >
            {item.producer} — {item.wine_name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {summary}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-semibold tabular-nums">
              {item.quantity}×
            </span>
            {item.ratings.length > 0 ? (
              <RatingBadges ratings={item.ratings} />
            ) : null}
          </div>
          <button
            type="button"
            aria-label={`More information about ${item.producer} ${item.wine_name}`}
            aria-expanded={expanded}
            aria-controls={`mobile-wine-details-${item.id}`}
            onClick={() => setExpanded((value) => !value)}
            className="flex size-11 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
          >
            <Info className="size-4" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div
          id={`mobile-wine-details-${item.id}`}
          className="mt-3 border-t pt-3 text-xs"
        >
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-muted-foreground">Wine</dt>
            <dd>
              {item.producer} — {item.wine_name}
              {item.vintage ? ` (${item.vintage})` : ''}
            </dd>
            <dt className="text-muted-foreground">Style</dt>
            <dd className="capitalize">
              {[item.wine_type, item.varietal].filter(Boolean).join(' · ') ||
                '—'}
            </dd>
            <dt className="text-muted-foreground">Inventory</dt>
            <dd className="tabular-nums">
              {item.quantity} × {size} mL
            </dd>
            <dt className="text-muted-foreground">Acquired</dt>
            <dd>
              {item.acquired_price != null
                ? `$${item.acquired_price.toFixed(2)} each`
                : 'Price unknown'}
              {item.acquired_from ? ` · ${item.acquired_from}` : ''}
            </dd>
            <dt className="text-muted-foreground">Origin</dt>
            <dd>{origin || '—'}</dd>
            <dt className="text-muted-foreground">Drink</dt>
            <dd>
              <DrinkingWindow
                start={item.drinking_window_start}
                end={item.drinking_window_end}
              />
            </dd>
          </dl>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Link
              to="/wine/$wineId/"
              params={{ wineId: String(item.id) }}
              className="text-muted-foreground underline underline-offset-4"
            >
              Full details
            </Link>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                disabled={pending || item.quantity < 1}
                onClick={() => drink(item, 1)}
              >
                Drink one
              </Button>
              {item.quantity > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => drinkAll(item)}
                >
                  Drink all
                </Button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p
              role="status"
              className="mt-2 text-right text-[10px] text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function InventoryRow({
  item,
  drinkControls,
}: {
  item: CellarItem
  drinkControls: DrinkControls
}) {
  const { drink, drinkAll, errors, pendingIds } = drinkControls
  const error = errors.get(item.id)
  const pending = pendingIds.has(item.id)
  const size = item.bottle_size_ml ?? 750
  return (
    <TableRow className="align-top">
      <TableCell className="px-4 py-3 whitespace-normal">
        <div className="flex items-start gap-3">
          <WineTypeIcon
            wineType={item.wine_type}
            className="h-10 w-8 shrink-0 text-muted-foreground"
          />
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
      <TableCell className="whitespace-normal">
        <DrinkingWindow
          start={item.drinking_window_start}
          end={item.drinking_window_end}
        />
      </TableCell>
      <TableCell className="whitespace-normal">
        {item.ratings.length > 0 ? (
          <RatingBadges ratings={item.ratings} />
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
              onClick={() => drink(item, 1)}
              title="Drink one bottle"
            >
              Drink
            </Button>
            {item.quantity > 1 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => drinkAll(item)}
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
