import { useId } from 'react'

type WineTypeIconProps = {
  wineType: string | null
  className?: string
}

type IconStyle = {
  label: string
  color: string
  sparkling?: boolean
}

const ICON_STYLES: Record<string, IconStyle> = {
  red: { label: 'Red wine', color: '#7f1d3f' },
  white: { label: 'White wine', color: '#e7c96b' },
  rose: { label: 'Rosé wine', color: '#e8909d' },
  orange: { label: 'Orange wine', color: '#d97706' },
  sparkling: {
    label: 'Sparkling wine',
    color: '#d9b84f',
    sparkling: true,
  },
  dessert: { label: 'Dessert wine', color: '#b7791f' },
  fortified: { label: 'Fortified wine', color: '#92400e' },
  other: { label: 'Other wine', color: '#8b8b8b' },
}

const FALLBACK_STYLE: IconStyle = {
  label: 'Wine type unknown',
  color: '#a1a1aa',
}

const BOWL_PATH = 'M8 4h16l-1.1 10.4A7 7 0 0 1 16 20.7a7 7 0 0 1-6.9-6.3L8 4Z'
const FLUTE_PATH = 'M12.3 4h7.4l-.5 14.5a3.2 3.2 0 0 1-6.4 0Z'

/**
 * A compact wine-glass marker: liquid color shows the style; sparkling wine
 * pours into a champagne flute. The liquid is a band clipped by the bowl
 * silhouette itself, so contents can never drift outside the glass.
 */
export function WineTypeIcon({ wineType, className = '' }: WineTypeIconProps) {
  const style = wineType
    ? (ICON_STYLES[wineType] ?? FALLBACK_STYLE)
    : FALLBACK_STYLE
  const clipId = useId()

  return (
    <svg
      viewBox="0 0 32 40"
      role="img"
      aria-label={style.label}
      className={className}
      data-wine-type={wineType ?? 'unknown'}
    >
      {style.sparkling ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <path d={FLUTE_PATH} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`} aria-hidden="true">
            <rect x="11" y="8.5" width="10" height="14" fill={style.color} opacity="0.92" />
            <g fill="#fff7cc" opacity="0.95">
              <circle cx="15.3" cy="11" r="0.62" />
              <circle cx="16.9" cy="13.2" r="0.52" />
              <circle cx="15.5" cy="15.6" r="0.5" />
              <circle cx="16.5" cy="18.2" r="0.45" />
            </g>
          </g>
          <path
            d={FLUTE_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M16 21.7v14.3M11.5 36h9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <defs>
            <clipPath id={clipId}>
              <path d={BOWL_PATH} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`} aria-hidden="true">
            <rect x="6" y="12.5" width="20" height="10" fill={style.color} opacity="0.92" />
          </g>
          <path
            d={BOWL_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M16 20.7v15.3M11.5 36h9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}

export function WineDetailIcon({
  wineType,
}: Pick<WineTypeIconProps, 'wineType'>) {
  return (
    <span data-detail-icon className="shrink-0 rounded-xl bg-muted/60 p-2">
      <WineTypeIcon
        wineType={wineType}
        className="h-12 w-10 text-muted-foreground"
      />
    </span>
  )
}
