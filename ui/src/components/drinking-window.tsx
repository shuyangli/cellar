type DrinkingYearState = 'past' | 'current' | 'future' | 'unknown'

type DrinkingWindowProps = {
  start: string | null
  end: string | null
  year?: number
  className?: string
}

function extractYear(value: string | null): number | null {
  const match = value?.match(/(?:19|20)\d{2}/)
  return match ? Number(match[0]) : null
}

export function drinkingYearState(
  value: string | null,
  currentYear = new Date().getFullYear(),
): DrinkingYearState {
  const year = extractYear(value)
  if (year == null) return 'unknown'
  if (year < currentYear) return 'past'
  if (year > currentYear) return 'future'
  return 'current'
}

const STATE_CLASSES: Record<DrinkingYearState, string> = {
  past: 'text-muted-foreground opacity-50',
  current: 'font-medium text-emerald-700 dark:text-emerald-400',
  future: 'text-amber-700 dark:text-amber-400',
  unknown: 'text-muted-foreground',
}

function YearValue({ value, year }: { value: string; year: number }) {
  const state = drinkingYearState(value, year)
  return (
    <span className={STATE_CLASSES[state]} data-year-state={state}>
      {value}
    </span>
  )
}

/** Drinking-window years styled by whether they are past, current, or future. */
export function DrinkingWindow({
  start,
  end,
  year = new Date().getFullYear(),
  className = '',
}: DrinkingWindowProps) {
  if (!start && !end) return <span className={className}>—</span>
  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${className}`}
    >
      {start ? <YearValue value={start} year={year} /> : <span>now</span>}
      <span className="sr-only">to</span>
      <span className="text-muted-foreground/50" aria-hidden="true">
        →
      </span>
      {end ? (
        <YearValue value={end} year={year} />
      ) : (
        <span className="text-muted-foreground">open</span>
      )}
    </span>
  )
}
