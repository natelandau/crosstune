import { useState } from 'react'
import { STATUSES, type TuneStatus } from '../../api/vocabulary'
import { isTuneStatus } from '../../domain/status'
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { CAPSULE_HIT } from '../Capsule'
import { PRESS } from '../press'
import { StatusGlyph } from '../StatusGlyph'
import { TraceRing } from '../TraceRing'

// The chosen word takes its status's own color, as its glyph does.
const CHOSEN: Record<TuneStatus, string> = {
  known: 'data-[selected]:bg-known/15 hover:data-[selected]:bg-known/25',
  learning: 'data-[selected]:bg-learning/15 hover:data-[selected]:bg-learning/25',
  want_to_learn: 'data-[selected]:bg-unknown/15 hover:data-[selected]:bg-unknown/25',
}
const RING: Record<TuneStatus, string> = {
  known: 'var(--known)',
  learning: 'var(--learning)',
  want_to_learn: 'var(--unknown)',
}

/**
 * A tune's status as a rail of the three words, each with its glyph. A tune always has a
 * status, so pressing the chosen one leaves it chosen.
 */
export function StatusRail({
  label,
  value,
  onChange,
}: {
  label: string
  /** The stored status; one this client cannot read shows as want to learn. */
  value: string
  onChange: (status: TuneStatus) => void
}) {
  const chosen = isTuneStatus(value) ? value : 'want_to_learn'
  // The ring traces in only for a choice made here, never for the value the rail opens with.
  const [picked, setPicked] = useState<TuneStatus | null>(null)
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[chosen]}
      onSelectionChange={(keys) => {
        const [key] = keys
        if (typeof key === 'string' && isTuneStatus(key)) {
          setPicked(key)
          onChange(key)
        }
      }}
      className="flex flex-wrap gap-2"
    >
      {STATUSES.map((status) => (
        <ToggleButton
          key={status}
          id={status}
          className={`${CAPSULE_HIT} bg-fill text-ink hover:bg-fill-hover inline-flex h-[min(2rem,var(--target-filter))] items-center rounded-(--radius-capsule) px-3 ${PRESS} data-[selected]:font-medium ${CHOSEN[status]}`}
        >
          <StatusGlyph status={status} labelled />
          {status === chosen && <TraceRing color={RING[status]} run={picked === status} />}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
