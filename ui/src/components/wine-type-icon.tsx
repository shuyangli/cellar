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

/** A compact wine-glass marker: liquid color shows the style; sparkling wine pours into a champagne flute. */
export function WineTypeIcon({ wineType, className = '' }: WineTypeIconProps) {
  const style = wineType
    ? (ICON_STYLES[wineType] ?? FALLBACK_STYLE)
    : FALLBACK_STYLE

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
          <g fill={style.color} opacity="0.8" aria-hidden="true">
            <circle cx="10.4" cy="6.8" r="1.05" />
            <circle cx="21.6" cy="8.2" r="0.8" />
          </g>
          <path
            d="M12.3 4h7.4l-.5 14.5a3.2 3.2 0 0 1-6.4 0L12.3 4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M12.98 9h6.04l-.32 9.2a2.7 2.7 0 0 1-5.4 0L12.98 9Z"
            fill={style.color}
            opacity="0.92"
          />
          <g fill="#fff7cc" opacity="0.95" aria-hidden="true">
            <circle cx="15.4" cy="12" r="0.6" />
            <circle cx="16.8" cy="14.8" r="0.5" />
            <circle cx="15.8" cy="17.4" r="0.45" />
          </g>
          <path
            d="M16 21.7v11.8M11.5 36h9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M8 4h16l-1.1 10.4A7 7 0 0 1 16 20.7a7 7 0 0 1-6.9-6.3L8 4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M9.7 12.5h12.6l-.2 1.7A6.15 6.15 0 0 1 16 19.7a6.15 6.15 0 0 1-6.1-5.5l-.2-1.7Z"
            fill={style.color}
            opacity="0.92"
          />
          <path
            d="M16 20.7v12.8M11.5 36h9"
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
