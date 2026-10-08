import { sortOrigins, sourceLabel } from './recordingRow'
import { ALL_RECORDINGS, SOURCE_SECTION } from './recordingsCopy'
import type { OriginChoice } from './useRecordingsOrigin'
import { DONE } from '../../ui/confirmCopy'
import { FILTERS, RESET } from '../../ui/filterCopy'
import { Group } from '../../ui/form/Group'
import { Picker } from '../../ui/form/Picker'
import { Sheet } from '../../ui/Sheet'

/**
 * The Recordings filter: one Source choice of All, Mine, then each import site. The choice
 * applies at once, and Reset returns to All.
 */
export function RecordingsFilterSheet({
  isOpen,
  onOpenChange,
  choice,
  origins,
  onChange,
  onClosed,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  choice: OriginChoice
  /** The import sites the musician holds a recording from. */
  origins: readonly string[]
  onChange: (next: OriginChoice) => void
  onClosed?: () => void
}) {
  // A chosen site the musician no longer holds keeps its option, or the choice would read as
  // All while the list stays narrowed.
  const stale = choice !== 'all' && choice !== 'own' && !origins.includes(choice)
  const sources = ['own', ...sortOrigins(stale ? [...origins, choice] : origins)]
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onClosed={onClosed}
      title={FILTERS}
      leading={{ label: RESET, onPress: () => onChange('all'), isDisabled: choice === 'all' }}
      primary={{ label: DONE, onPress: () => onOpenChange(false) }}
    >
      <Group>
        <Picker
          label={SOURCE_SECTION}
          value={choice === 'all' ? null : choice}
          options={sources.map((source) => ({ id: source, label: sourceLabel(source) }))}
          emptyLabel={ALL_RECORDINGS}
          onChange={(value) => onChange(value ?? 'all')}
        />
      </Group>
    </Sheet>
  )
}
