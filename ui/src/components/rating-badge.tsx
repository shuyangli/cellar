import { useState } from 'react'

import { Badge } from '#/components/ui/badge'
import type { RatingByUser } from '#/lib/cellar'

/**
 * A rating and who gave it, as "89S". The initial comes from the API as a plain
 * first letter, so two reviewers can share one; tapping the badge flips the
 * initial to the full name ("89Shuyang") and tapping again flips it back, so the
 * badge stays compact by default but is always resolvable.
 */
export function RatingBadge({
  rating,
  initials,
  name,
  title,
}: {
  rating: number
  initials?: string | null
  name?: string | null
  title?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = Boolean(name && initials)
  const label = expanded && name ? name : initials
  const toggle = () => setExpanded((v) => !v)
  return (
    <Badge
      className={canExpand ? 'tabular-nums cursor-pointer' : 'tabular-nums'}
      title={title}
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
      onClick={canExpand ? toggle : undefined}
      onKeyDown={
        canExpand
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggle()
              }
            }
          : undefined
      }
    >
      {rating}
      {label ? (
        // Not tabular-nums: the label is letters, and keeping it in the same
        // span would widen every badge to the letter's advance.
        <span className="ml-0.5 font-normal opacity-80">{label}</span>
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
          name={entry.user_name}
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
