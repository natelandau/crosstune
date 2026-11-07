import { Check } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import type { PlaceResult } from '../../api/types'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { SearchField } from '../../ui/SearchField'
import { pickLocationName } from './recordingsCopy'
import type { PlaceSearchState } from './usePlaceSearch'

// The search endpoint's longest text.
const MAX_QUERY = 100

/**
 * A location to pick: its name, the line under it when there is one, how far it is when known,
 * and a check when it is the recording's now.
 */
export function LocationRow({
  name,
  detail,
  distance,
  current = false,
  isDisabled = false,
  onPress,
}: {
  name: string
  detail?: string | null
  /** How far the location is, as `formatDistance` writes it. */
  distance?: string | null
  current?: boolean
  isDisabled?: boolean
  onPress: () => void
}) {
  const id = useId()
  return (
    <AriaButton
      onPress={onPress}
      isDisabled={isDisabled}
      aria-current={current || undefined}
      aria-label={pickLocationName(name, detail)}
      aria-describedby={detail ? `${id}-detail` : undefined}
      className={`${FIELD_ROW_PRESSABLE} ph-no-capture py-2`}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        {detail && (
          <span id={`${id}-detail`} className="t-secondary text-secondary truncate">
            {detail}
          </span>
        )}
      </span>
      {distance && <span className="t-secondary text-secondary t-num shrink-0">{distance}</span>}
      {current && <Check className="text-accent size-5 shrink-0" aria-hidden />}
    </AriaButton>
  )
}

/**
 * A place search's field and what `search` answered: while the field holds text, the results
 * show under it, then `children`. Picking a result hands it to `onPick`.
 */
export function PlaceSearch({
  label,
  query,
  onQueryChange,
  search,
  distanceOf,
  onPick,
  autoFocus = false,
  children,
}: {
  /** The field's name and placeholder. */
  label: string
  query: string
  onQueryChange: (query: string) => void
  /** The search for `query`, from `usePlaceSearch`. */
  search: PlaceSearchState
  /** How far a result is, null when there is nothing to measure from. */
  distanceOf?: (at: { lat: number; lon: number }) => string | null
  onPick: (result: PlaceResult) => void
  autoFocus?: boolean
  /** Shown after the results while the field holds text. */
  children?: ReactNode
}) {
  const statusId = useId()
  const field = useRef<HTMLInputElement>(null)
  const { results, message } = search

  useEffect(() => {
    if (autoFocus) field.current?.focus()
  }, [autoFocus])

  return (
    <>
      <div className="pt-2">
        <SearchField
          ref={field}
          label={label}
          value={query}
          maxLength={MAX_QUERY}
          describedBy={statusId}
          onChange={onQueryChange}
        />
      </div>
      {/* Always in the tree, so a screen reader hears each message as it lands. */}
      <div id={statusId} role="status">
        {message && <p className="t-secondary text-secondary px-4 pt-2">{message}</p>}
      </div>
      {results.length > 0 && (
        <Group>
          {results.map((result, i) => (
            <LocationRow
              key={`${result.lat},${result.lon},${i}`}
              name={result.title}
              detail={result.subtitle}
              distance={distanceOf?.(result)}
              onPress={() => onPick(result)}
            />
          ))}
        </Group>
      )}
      {query.trim() !== '' && children}
    </>
  )
}
