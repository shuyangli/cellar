import { CELLAR_BASE_PATH } from './base-path'

export type CellarItem = {
  id: number
  producer: string
  wine_name: string
  vintage: string | null
  country: string | null
  region: string | null
  appellation: string | null
  varietal: string | null
  wine_type: string | null
  grapes: string | null
  quantity: number
  bottle_size_ml: number | null
  location: string | null
  acquired_from: string | null
  acquired_price: number | null
  drinking_window_start: string | null
  drinking_window_end: string | null
  notes: string | null
  source_app: string | null
  cellartracker_wine_id: string | null
  photo_ref: string | null
  last_event_reason: string | null
  updated_at: string | null
  avg_rating: number | null
  ratings: Array<RatingByUser>
  label_photo: string | null
}

/** One reviewer's rating of one wine — rendered as "89S". */
export type RatingByUser = {
  user_id: number | null
  user_name: string | null
  initials: string
  rating: number
  /** How many tastings the rating averages over. */
  tastings: number
}

/** A person who reviews wine. Anyone can be added just by naming them. */
export type User = {
  id: number
  name: string
  is_default: number
  /** First initial of the name; the rating suffix (e.g. "S"). */
  initials: string
  tasting_count: number
  last_tasted_on: string | null
}

export type Purchase = {
  id: number
  wine_id: number
  quantity: number
  price_per_bottle: number | null
  currency: string
  vendor: string | null
  purchase_date: string | null
  source: string
  notes: string | null
  created_at: string
}

export type Tasting = {
  id: number
  wine_id: number
  user_id: number | null
  user_name: string | null
  user_initials: string
  context_type: string
  venue: string | null
  price_paid: number | null
  rating: number | null
  liked: number
  buy_again: number
  tasting_notes: string | null
  food_pairing: string | null
  tasted_on: string | null
  created_at: string
}

export type TastingWithWine = Tasting & {
  producer: string
  wine_name: string
  vintage: string | null
  wine_type: string | null
  region: string | null
  country: string | null
}

/** A wine we want to try or buy, joined to the wine row it points at. */
export type WishlistEntry = {
  id: number
  wine_id: number
  recommended_by: string | null
  reason: string | null
  shop_name: string | null
  listed_price: number | null
  created_at: string
  producer: string
  wine_name: string
  vintage: string | null
  wine_type: string | null
  region: string | null
  country: string | null
  /** Bottles currently held — non-zero means the recommendation is already in the cellar. */
  quantity: number
}

export type InventoryEvent = {
  id: number
  wine_id: number
  delta: number
  event_type: string
  reason: string | null
  occurred_at: string
}

export type Photo = {
  id: number
  kind: string
  path: string
}

export type WineDossier = CellarItem & {
  purchases: Array<Purchase>
  tastings: Array<Tasting>
  events: Array<InventoryEvent>
  photos: Array<Photo>
}

export type DrinkNowPayload = {
  year: number
  ready: Array<CellarItem & { closing_soon?: boolean }>
  approaching: Array<CellarItem>
  past_peak: Array<CellarItem>
  no_window: Array<CellarItem>
}

export type StatsPayload = {
  summary: CellarSummary
  by_type: Array<{ wine_type: string; bottles: number; labels: number }>
  by_country: Array<{ country: string; bottles: number; labels: number }>
  by_region: Array<{ region: string; bottles: number; labels: number }>
  spend_by_month: Array<{ month: string; spend: number; bottles: number }>
  top_rated: Array<{
    id: number
    producer: string
    wine_name: string
    vintage: string | null
    quantity: number
    avg_rating: number
    tastings: number
  }>
  recent_tastings: Array<{
    id: number
    wine_id: number
    producer: string
    wine_name: string
    vintage: string | null
    rating: number | null
    tasted_on: string | null
    user_name: string | null
  }>
}

export type InventoryFilters = {
  q?: string
  wine_type?: string
  country?: string
  region?: string
  in_stock?: boolean
}

export type CellarSummary = {
  labels: {
    bottles: number
    labels: number
    producers: number
    regions: number
  }
  estimated_cost: number
}

export type CellarPagination = {
  page: number
  page_size: number
  total_items: number
  total_pages: number
  has_prev: boolean
  has_next: boolean
}

export type CellarPayload = {
  summary: CellarSummary
  items: Array<CellarItem>
  pagination: CellarPagination
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number]
export const DEFAULT_PAGE_SIZE: PageSizeOption = 25

/** Default search params for the cellar index route (page 1, default size). */
export const DEFAULT_CELLAR_SEARCH = { page: 1, page_size: DEFAULT_PAGE_SIZE }

function apiBase(): string {
  if (typeof window === 'undefined') {
    return (
      (typeof process !== 'undefined' && process.env.VITE_API_TARGET) ||
      'http://127.0.0.1:8788'
    )
  }
  return CELLAR_BASE_PATH
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export async function fetchCellar(
  page: number,
  pageSize: number,
  filters: InventoryFilters = {},
): Promise<CellarPayload> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  if (filters.q) params.set('q', filters.q)
  if (filters.wine_type) params.set('wine_type', filters.wine_type)
  if (filters.country) params.set('country', filters.country)
  if (filters.region) params.set('region', filters.region)
  if (filters.in_stock === false) params.set('in_stock', 'false')
  return fetchJson<CellarPayload>(`/api/cellar?${params}`)
}

export function fetchWine(wineId: number | string): Promise<WineDossier> {
  return fetchJson<WineDossier>(`/api/wines/${wineId}`)
}

export function fetchDrinkNow(): Promise<DrinkNowPayload> {
  return fetchJson<DrinkNowPayload>('/api/drink-now')
}

export function fetchStats(): Promise<StatsPayload> {
  return fetchJson<StatsPayload>('/api/stats')
}

export function fetchUsers(): Promise<Array<User>> {
  return fetchJson<Array<User>>('/api/users')
}

export function fetchTastings(limit = 200): Promise<Array<TastingWithWine>> {
  return fetchJson<Array<TastingWithWine>>(`/api/tastings?limit=${limit}`)
}

export function fetchWishlist(): Promise<Array<WishlistEntry>> {
  return fetchJson<Array<WishlistEntry>>('/api/wishlist')
}

export function photoUrl(path: string): string {
  return `${apiBase()}/photos/${path}`
}

async function mutate<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers:
      body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const payload = (await res.json()) as { detail?: string }
      if (payload.detail) detail = payload.detail
    } catch {
      // keep the status text
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

export type WineUpdate = Partial<{
  producer: string
  wine_name: string
  vintage: string
  country: string
  region: string
  appellation: string
  varietal: string
  wine_type: string
  grapes: string
  bottle_size_ml: number
  location: string
  drinking_window_start: string
  drinking_window_end: string
  notes: string
}>

export function updateWine(
  wineId: number,
  fields: WineUpdate,
): Promise<WineDossier> {
  return mutate<WineDossier>(`/api/wines/${wineId}`, 'PATCH', fields)
}

export function deleteWine(wineId: number): Promise<{ ok: boolean }> {
  return mutate<{ ok: boolean }>(`/api/wines/${wineId}`, 'DELETE')
}

export function deleteTasting(tastingId: number): Promise<WineDossier> {
  return mutate<WineDossier>(`/api/tastings/${tastingId}`, 'DELETE')
}

export function deletePurchase(purchaseId: number): Promise<WineDossier> {
  return mutate<WineDossier>(`/api/purchases/${purchaseId}`, 'DELETE')
}

export function adjustInventory(
  wineId: number,
  delta: number,
  reason: string,
  eventType: 'adjust' | 'consume' | 'gift' = 'adjust',
): Promise<WineDossier> {
  return mutate<WineDossier>(`/api/cellar/items/${wineId}/adjust`, 'POST', {
    delta,
    reason,
    event_type: eventType,
  })
}

/** Fields describing a wine we tasted somewhere but never owned. */
export type ExternalWineDraft = {
  producer: string
  wine_name: string
  vintage?: string
  wine_type?: string
  region?: string
  country?: string
}

/**
 * Create a wine row with no bottles attached. Used for wines tasted elsewhere:
 * they belong in the tasting history without ever entering the inventory, so
 * they stay out of the default in-stock cellar view.
 */
export function createExternalWine(
  draft: ExternalWineDraft,
): Promise<WineDossier> {
  return mutate<WineDossier>('/api/cellar/items', 'POST', {
    ...draft,
    quantity: 0,
  })
}

export type TastingDraft = {
  /** Reviewer name or id. A name that's new creates that reviewer. */
  user?: string | number | null
  rating?: number | null
  tasting_notes?: string
  food_pairing?: string
  context_type?: string
  venue?: string
  price_paid?: number | null
  buy_again?: boolean
  tasted_on?: string
  consume_bottle?: boolean
}

export function logTasting(
  wineId: number,
  draft: TastingDraft,
): Promise<WineDossier> {
  return mutate<WineDossier>(`/api/wines/${wineId}/tastings`, 'POST', draft)
}

/** Raw form values for a wine tasted away from the cellar. */
export type ExternalTastingInput = {
  /** Set when the wine is already on file, so we extend its history instead of forking it. */
  matchedWineId: number | null
  producer: string
  wine_name: string
  vintage: string
  wine_type: string
  region: string
  country: string
  /** Who is rating it. Blank means the default reviewer. */
  user: string
  context_type: string
  venue: string
  tasted_on: string
  /** Free text so the field can be left blank; validated here. */
  rating: string
  price_paid: string
  buy_again: boolean
  notes: string
}

export type ParsedExternalTasting = {
  wineId: number | null
  wine: ExternalWineDraft | null
  tasting: TastingDraft
}

/**
 * Validate and normalise the form values. Kept separate from the component so
 * the rules are testable without mounting a router.
 */
export function parseExternalTasting(
  input: ExternalTastingInput,
): { ok: true; value: ParsedExternalTasting } | { ok: false; error: string } {
  const ratingText = input.rating.trim()
  const rating = ratingText ? Number(ratingText) : null
  if (
    rating !== null &&
    (!Number.isInteger(rating) || rating < 0 || rating > 100)
  ) {
    return { ok: false, error: 'Rating must be a whole number from 0 to 100.' }
  }

  const priceText = input.price_paid.trim()
  const price = priceText ? Number(priceText) : null
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return { ok: false, error: 'Price must be a number of 0 or more.' }
  }

  const producer = input.producer.trim()
  const wineName = input.wine_name.trim()
  if (input.matchedWineId == null && (!producer || !wineName)) {
    return { ok: false, error: 'Producer and wine name are required.' }
  }

  return {
    ok: true,
    value: {
      wineId: input.matchedWineId,
      wine:
        input.matchedWineId == null
          ? {
              producer,
              wine_name: wineName,
              vintage: input.vintage.trim(),
              wine_type: input.wine_type,
              region: input.region.trim(),
              country: input.country.trim(),
            }
          : null,
      tasting: {
        user: input.user.trim() || null,
        rating,
        price_paid: price,
        tasting_notes: input.notes.trim(),
        context_type: input.context_type,
        venue: input.venue.trim(),
        buy_again: input.buy_again,
        tasted_on: input.tasted_on,
      },
    },
  }
}

/**
 * Persist a tasting that happened away from the cellar, creating the wine first
 * if we've never seen it. Inventory is never touched: `consume_bottle` is
 * forced false here so no caller can accidentally drain a bottle we still hold.
 */
export async function saveExternalTasting(
  parsed: ParsedExternalTasting,
): Promise<WineDossier> {
  const wineId = parsed.wineId ?? (await createExternalWine(parsed.wine!)).id
  return logTasting(wineId, { ...parsed.tasting, consume_bottle: false })
}

export type WishlistDraft = {
  wine_id: number
  recommended_by?: string
  reason?: string
  shop_name?: string
  listed_price?: number | null
}

export function addWishlistEntry(draft: WishlistDraft): Promise<WishlistEntry> {
  return mutate<WishlistEntry>('/api/wishlist', 'POST', draft)
}

export function removeWishlistEntry(
  wishlistId: number,
): Promise<{ ok: boolean }> {
  return mutate<{ ok: boolean }>(`/api/wishlist/${wishlistId}`, 'DELETE')
}

/** Raw form values for a wine someone suggested we try. */
export type WishlistInput = {
  /** Set when the wine is already on file, so the entry points at the known row. */
  matchedWineId: number | null
  producer: string
  wine_name: string
  vintage: string
  wine_type: string
  region: string
  country: string
  recommended_by: string
  reason: string
  shop_name: string
  /** Free text so the field can be left blank; validated here. */
  listed_price: string
}

export type ParsedWishlist = {
  wineId: number | null
  wine: ExternalWineDraft | null
  entry: Omit<WishlistDraft, 'wine_id'>
}

/**
 * Validate and normalise wishlist form values. Kept separate from the component
 * so the rules are testable without mounting a router.
 */
export function parseWishlistInput(
  input: WishlistInput,
): { ok: true; value: ParsedWishlist } | { ok: false; error: string } {
  const priceText = input.listed_price.trim()
  const price = priceText ? Number(priceText) : null
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return { ok: false, error: 'Price must be a number of 0 or more.' }
  }

  const producer = input.producer.trim()
  const wineName = input.wine_name.trim()
  if (input.matchedWineId == null && (!producer || !wineName)) {
    return { ok: false, error: 'Producer and wine name are required.' }
  }

  return {
    ok: true,
    value: {
      wineId: input.matchedWineId,
      wine:
        input.matchedWineId == null
          ? {
              producer,
              wine_name: wineName,
              vintage: input.vintage.trim(),
              wine_type: input.wine_type,
              region: input.region.trim(),
              country: input.country.trim(),
            }
          : null,
      entry: {
        recommended_by: input.recommended_by.trim(),
        reason: input.reason.trim(),
        shop_name: input.shop_name.trim(),
        listed_price: price,
      },
    },
  }
}

/**
 * Persist a wishlist entry, creating the wine first if we've never seen it. The
 * wine is created with quantity 0 so wanting a bottle never implies owning one.
 */
export async function saveWishlistEntry(
  parsed: ParsedWishlist,
): Promise<WishlistEntry> {
  const wineId = parsed.wineId ?? (await createExternalWine(parsed.wine!)).id
  return addWishlistEntry({ ...parsed.entry, wine_id: wineId })
}

/** Where a wine was tasted. Free text in the DB; these are just the common ones. */
export const TASTING_CONTEXT_OPTIONS = [
  'restaurant',
  'wine bar',
  'tasting room',
  'friend',
  'event',
  'other',
] as const

export const WINE_TYPE_OPTIONS = [
  'red',
  'white',
  'rose',
  'sparkling',
  'dessert',
  'fortified',
  'orange',
  'other',
] as const

export function formatWineTitle(item: {
  producer: string
  wine_name: string
  vintage: string | null
}): string {
  return `${item.producer} ${item.wine_name}${item.vintage ? ` ${item.vintage}` : ''}`
}
