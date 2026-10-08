import { useRef, type ReactNode } from 'react'
import { ARCHIVED } from './archiveLabels'
import { COMPOSER_LABEL } from './detailFields'
import type { TuneBadge, TuneFacts } from './useTuneScreen'
import { isTuningKey } from '../settings/instruments'
import { useFrame } from '../../platform/frame'
import { usePaneTitleLine } from '../../app/ColumnTitle'
import { KeyPill } from '../../ui/KeyPill'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { TUNE } from './tunePageCopy'

/** The view-transition name a tune's title carries in its row and on its page. */
// eslint-disable-next-line react-refresh/only-export-components
export const tuneTitleTransition = (tuneId: string) => `tune-title-${tuneId}`

/** The facts line after the key and modes, in this order; any other facet follows. */
const FACT_ORDER = ['tune_type', 'time_signature', 'is_crooked', 'part_structure', 'genre']

const rank = (field: string) => {
  const at = FACT_ORDER.indexOf(field)
  return at === -1 ? FACT_ORDER.length : at
}

interface Part {
  key: string
  node: ReactNode
  /** Whether a middle dot sets this part apart from the one before it. */
  dotted: boolean
}

/**
 * A line of parts that wraps whole parts, never a dot alone. Each part carries its separator
 * on its leading edge in a slot of fixed width, and the line starts that wide before its box,
 * which clips it, so the part that opens a wrapped line never shows a dot. Parts that sit
 * apart only by a dot run together for a screen reader, so a hidden comma marks each boundary.
 */
function PartsLine({ parts, className = '' }: { parts: Part[]; className?: string }) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <p className="-ms-[1em] flex flex-wrap items-center gap-y-1">
        {parts.map((part, index) => (
          <span key={part.key} data-part className="flex min-w-0 items-center">
            <span aria-hidden className="w-[1em] shrink-0 text-center">
              {part.dotted ? '·' : ''}
            </span>
            {index > 0 && <span className="sr-only">, </span>}
            {part.node}
          </span>
        ))}
      </p>
    </div>
  )
}

/**
 * A tune page's header: the title in the page title role, other names and the composer, a
 * facts line of key, modes, and form, and a line of status and tunings, each tuning naming its
 * instrument. Archived is a small capsule last. Until the facts have read it is the title
 * alone, or a hidden "Tune" while even that is unknown, so focus and the morph have one heading
 * to land on throughout. `active` is false for a page held off screen, which leaves the pane
 * bar's title to the page on screen.
 */
export function TuneHeader({
  tuneId,
  title,
  facts,
  badges,
  active,
}: {
  tuneId: string
  /** The title to show before the facts have read; the facts' own title wins. */
  title: string | undefined
  facts: TuneFacts | null
  badges: TuneBadge[]
  active: boolean
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  usePaneTitleLine(titleRef, active)
  const shownTitle = facts?.title ?? title
  // Only off wide does a row title morph into this one; on wide the title lifts with the page.
  const morphs = useFrame() !== 'wide'
  return (
    <header className="flex flex-col gap-1 pb-6">
      <h1
        ref={titleRef}
        className={shownTitle ? 't-page-title select-text' : 'sr-only'}
        style={morphs ? { viewTransitionName: tuneTitleTransition(tuneId) } : undefined}
      >
        {shownTitle ?? TUNE}
      </h1>
      {facts && <Facts facts={facts} badges={badges} />}
    </header>
  )
}

function Facts({ facts, badges }: { facts: TuneFacts; badges: TuneBadge[] }) {
  const tunings = badges.filter((badge) => isTuningKey(badge.field)).map((badge) => badge.label)
  const form = badges
    .filter((badge) => !isTuningKey(badge.field))
    .sort((a, b) => rank(a.field) - rank(b.field))
    .map((badge) => badge.label)
  const facets = [...facts.modes, ...form]
  const factParts: Part[] = [
    ...(facts.key
      ? [
          {
            key: 'key',
            node: (
              <>
                <span className="sr-only">Key </span>
                <KeyPill value={facts.key} compact />
              </>
            ),
            dotted: false,
          },
        ]
      : []),
    ...facets.map((facet, index) => ({
      key: `facet-${index}-${facet}`,
      node: <span>{facet}</span>,
      dotted: index > 0,
    })),
  ]
  const statusParts: Part[] = [
    { key: 'status', node: <StatusGlyph status={facts.status} labelled />, dotted: false },
    ...tunings.map((tuning, index) => ({
      key: `tuning-${index}-${tuning}`,
      node: <span className="text-ink-2">{tuning}</span>,
      dotted: true,
    })),
    ...(facts.archived
      ? [
          {
            key: 'archived',
            node: (
              <span className="t-caption bg-fill rounded-(--radius-capsule) px-2 py-0.5">
                {ARCHIVED}
              </span>
            ),
            dotted: false,
          },
        ]
      : []),
  ]
  return (
    <>
      {facts.alternateTitles.length > 0 && (
        <p className="t-secondary text-ink-2">{facts.alternateTitles.join(', ')}</p>
      )}
      {facts.composer && (
        <p className="t-secondary text-ink-2">
          {COMPOSER_LABEL}: {facts.composer}
        </p>
      )}
      {factParts.length > 0 && <PartsLine parts={factParts} className="t-secondary pt-2" />}
      <PartsLine parts={statusParts} className="t-secondary" />
    </>
  )
}
