export type CellarItem = {
  id: number
  producer: string
  wine_name: string
  vintage: string | null
  country: string | null
  region: string | null
  appellation: string | null
  varietal: string | null
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
      'http://127.0.0.1:8787'
    )
  }
  return ''
}

export async function fetchCellar(
  page: number,
  pageSize: number,
): Promise<CellarPayload> {
  const url = `${apiBase()}/api/cellar?page=${page}&page_size=${pageSize}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load cellar: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as CellarPayload
}
