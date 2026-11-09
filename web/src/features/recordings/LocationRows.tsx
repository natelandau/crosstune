import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { PlaceResult } from '../../api/types'
import { Group } from '../../ui/form/Group'
import { Text } from 'react-aria-components'
import { PressableList, PressableOption } from '../../ui/PressableRow'
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
  id,
  name,
  detail,
  distance,
  isDisabled = false,
  onPress,
}: {
  /** Unique among the list's rows. */
  id: string
  name: string
  detail?: string | null
  /** How far the location is, as `formatDistance` writes it. */
  distance?: string | null
  isDisabled?: boolean
  onPress: () => void
}) {
  return (
    <PressableOption
      id={id}
      onPress={onPress}
      isDisabled={isDisabled}
      name={pickLocationName(name, detail)}
      className="ph-no-capture py-2"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        {detail && (
          <Text slot="description" className="t-secondary text-secondary truncate">
            {detail}
          </Text>
        )}
      </span>
      {distance && <span className="t-secondary text-secondary t-num shrink-0">{distance}</span>}
    </PressableOption>
  )
}

/** A list of `LocationRow`s to pick one from, with `selectedId` the one the recording has now. */
export function LocationList({
  label,
  showLabel = false,
  selectedId,
  children,
}: {
  /** The list's name. */
  label: string
  /** Shows the name as the group's heading. */
  showLabel?: boolean
  selectedId?: string | null
  children: ReactNode
}) {
  return (
    <Group header={showLabel ? label : undefined}>
      <PressableList aria-label={label} selectedId={selectedId}>
        {children}
      </PressableList>
    </Group>
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
        <LocationList label={label}>
          {results.map((result, i) => (
            <LocationRow
              key={`${result.lat},${result.lon},${i}`}
              id={`${result.lat},${result.lon},${i}`}
              name={result.title}
              detail={result.subtitle}
              distance={distanceOf?.(result)}
              onPress={() => onPick(result)}
            />
          ))}
        </LocationList>
      )}
      {query.trim() !== '' && children}
    </>
  )
}
