import { Badge } from '#/components/ui/badge'
import type { RatingByUser } from '#/lib/cellar'

/**
 * A rating and who gave it, as "89S". The initials come from the API, which
 * derives them across every reviewer so two people never share a suffix.
 */
export function RatingBadge({
  rating,
  initials,
  title,
}: {
  rating: number
  initials?: string | null
  title?: string
}) {
  return (
    <Badge className="tabular-nums" title={title}>
      {rating}
      {initials ? (
        // Not tabular-nums: the initials are letters, and keeping them in the
        // same span would widen every badge to the letter's advance.
        <span className="ml-0.5 font-normal opacity-80">{initials}</span>
      ) : null}
    </Badge>
  )
}

/**
 * Every reviewer's rating for one wine — "89S 90A". Falls back to nothing when
 * no one has rated it, so callers can render this unconditionally.
 */
export function RatingBadges({
  ratings,
  className,
}: {
  ratings: Array<RatingByUser>
  className?: string
}) {
  if (ratings.length === 0) return null
  return (
    <span className={className ?? 'flex flex-wrap items-center gap-1'}>
      {ratings.map((entry) => (
        <RatingBadge
          key={entry.user_id ?? entry.initials}
          rating={entry.rating}
          initials={entry.initials}
          title={
            entry.tastings > 1
              ? `${entry.user_name ?? 'Unknown'} — average of ${entry.tastings} tastings`
              : (entry.user_name ?? 'Unknown')
          }
        />
      ))}
    </span>
  )
}
