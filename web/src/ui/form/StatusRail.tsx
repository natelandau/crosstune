import { STATUSES, type TuneStatus } from '../../api/vocabulary'
import { isTuneStatus } from '../../domain/status'
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { CAPSULE_HIT } from '../Capsule'
import { StatusGlyph } from '../StatusGlyph'

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
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[chosen]}
      onSelectionChange={(keys) => {
        const [key] = keys
        if (typeof key === 'string' && isTuneStatus(key)) onChange(key)
      }}
      className="flex flex-wrap gap-2"
    >
      {STATUSES.map((status) => (
        <ToggleButton
          key={status}
          id={status}
          className={`${CAPSULE_HIT} bg-fill text-ink data-[selected]:bg-set-fill data-[selected]:text-set-label inline-flex h-[min(2rem,var(--target-filter))] cursor-default items-center rounded-(--radius-capsule) px-3 transition-opacity duration-(--dur-short) ease-(--ease) data-[pressed]:opacity-60`}
        >
          <StatusGlyph status={status} labelled />
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
