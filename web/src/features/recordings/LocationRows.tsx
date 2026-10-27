import { Check } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import type { PlaceResult } from '../../api/types'
import { useSyncEngine } from '../../sync/SyncProvider'
import type { PlaceSearchOutcome } from '../../sync/types'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { SearchField } from '../../ui/SearchField'
import {
  LOCATION_SEARCH_OFFLINE,
  LOCATION_SEARCH_UNAVAILABLE,
  locationSearchBusy,
  NO_LOCATIONS_FOUND,
  pickLocationName,
  SEARCH_LOCATIONS,
} from './recordingsCopy'

// The search endpoint's bounds on the text it takes.
const MIN_QUERY = 2
const MAX_QUERY = 100

function outcomeMessage(outcome: PlaceSearchOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return NO_LOCATIONS_FOUND
    case 'offline':
      return LOCATION_SEARCH_OFFLINE
    case 'rate_limited':
      return locationSearchBusy(outcome.retryAfterSeconds)
    default:
      return LOCATION_SEARCH_UNAVAILABLE
  }
}

/**
 * A location to pick: its name, the line under it when there is one, and a check when it is the
 * recording's now.
 */
export function LocationRow({
  name,
  detail,
  current = false,
  isDisabled = false,
  onPress,
}: {
  name: string
  detail?: string | null
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
      {current && <Check className="text-accent size-5 shrink-0" aria-hidden />}
    </AriaButton>
  )
}

/**
 * The location page's search: two or more characters search once the typing has settled for
 * `settleMs`, and only the latest search's answer shows. Picking a result hands it to `onPick`.
 */
export function PlaceSearch({
  onPick,
  autoFocus = false,
  settleMs = 300,
}: {
  onPick: (result: PlaceResult) => void
  autoFocus?: boolean
  settleMs?: number
}) {
  const engine = useSyncEngine()
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<{ term: string; outcome: PlaceSearchOutcome } | null>(null)
  const latestAsk = useRef(0)
  const statusId = useId()
  const field = useRef<HTMLInputElement>(null)
  const trimmed = query.trim()
  const term = trimmed.length >= MIN_QUERY ? trimmed : null

  useEffect(() => {
    if (autoFocus) field.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    // Every change of term retires the search before it, so a slow answer never shows late.
    const ask = ++latestAsk.current
    if (term === null) return
    const timer = setTimeout(() => {
      void engine
        .searchPlaces(term)
        .catch((): PlaceSearchOutcome => ({ kind: 'failed' }))
        .then((outcome) => {
          if (ask === latestAsk.current) setAnswer({ term, outcome })
        })
    }, settleMs)
    return () => clearTimeout(timer)
  }, [engine, term, settleMs])

  const outcome = term !== null && answer?.term === term ? answer.outcome : undefined
  const results = outcome?.kind === 'ok' ? outcome.results : []
  const message = outcome && results.length === 0 ? outcomeMessage(outcome) : null

  return (
    <>
      <div className="pt-6">
        <SearchField
          ref={field}
          label={SEARCH_LOCATIONS}
          value={query}
          maxLength={MAX_QUERY}
          describedBy={statusId}
          onChange={setQuery}
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
              onPress={() => onPick(result)}
            />
          ))}
        </Group>
      )}
    </>
  )
}
