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

// KEEP IN SYNC: the iOS app draws the same glasses in
// ios/WineCellar/Components.swift (WineTypeIcon and its shapes, same 32x40
// design space). Any change to these silhouettes, fill lines, or bubbles
// should be mirrored there in the same change.
const BOWL_PATH =
  'M7.4 4h17.2l-1.3 11.8c-1.1 4.8-3.5 7-7.3 7-3.8 0-6.2-2.2-7.3-7L7.4 4Z'
const FLUTE_PATH =
  'M12.8 4h6.4c.8 2.6 2.1 5.4 2.1 9.2 0 4.7-2.3 8.4-5.3 9.5-3-1.1-5.3-4.8-5.3-9.5 0-3.8 1.3-6.6 2.1-9.2Z'

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
            <rect x="10" y="8" width="12" height="16" fill={style.color} opacity="0.92" />
            <g fill="#fff7cc" opacity="0.95">
              <circle cx="15.3" cy="11" r="0.65" />
              <circle cx="17" cy="13.6" r="0.55" />
              <circle cx="15.4" cy="16.4" r="0.52" />
              <circle cx="16.6" cy="19.2" r="0.45" />
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
            d="M16 22.7v13.3M11.5 36h9"
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
            <rect x="6" y="12" width="20" height="12" fill={style.color} opacity="0.92" />
          </g>
          <path
            d={BOWL_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M16 22.8v13.2M11.5 36h9"
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
