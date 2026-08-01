import type { CellarItem } from './cellar'

export type InventoryAdjustmentOutcome =
  | { kind: 'refreshed' }
  | { kind: 'mutation_failed'; message: string }
  | { kind: 'refresh_failed' }

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Keep the inventory mutation distinct from the UI refresh. Once the mutation
 * succeeds, a refresh failure must never look like a safe-to-retry mutation.
 */
export async function adjustInventoryAndRefresh(
  adjust: () => Promise<unknown>,
  refresh: () => Promise<unknown>,
): Promise<InventoryAdjustmentOutcome> {
  try {
    await adjust()
  } catch (cause) {
    return { kind: 'mutation_failed', message: errorMessage(cause) }
  }

  try {
    await refresh()
    return { kind: 'refreshed' }
  } catch {
    return { kind: 'refresh_failed' }
  }
}

export function mobileWineSummary(
  item: Pick<CellarItem, 'vintage' | 'wine_type' | 'varietal' | 'region'>,
): string {
  return [
    item.vintage || 'Vintage unknown',
    item.wine_type,
    item.varietal,
    item.region,
  ]
    .filter(Boolean)
    .join(' · ')
}
