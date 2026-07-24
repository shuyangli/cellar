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
  label_photo: string | null
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

function apiBase(): string {
  if (typeof window === 'undefined') {
    return (
      (typeof process !== 'undefined' && process.env.VITE_API_TARGET) ||
      'http://127.0.0.1:8788'
    )
  }
  return ''
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`)
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

export function fetchTastings(limit = 200): Promise<Array<TastingWithWine>> {
  return fetchJson<Array<TastingWithWine>>(`/api/tastings?limit=${limit}`)
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
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
): Promise<WineDossier> {
  return mutate<WineDossier>(`/api/cellar/items/${wineId}/adjust`, 'POST', {
    delta,
    reason,
  })
}

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
