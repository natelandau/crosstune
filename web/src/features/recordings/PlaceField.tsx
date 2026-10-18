import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
  type Key,
} from 'react-aria-components'
import { useSyncEngine } from '../../sync/SyncProvider'
import type { PlaceSearchOutcome } from '../../sync/types'
import { containsText } from '../../text/fold'
import { Button } from '../../ui/Button'
import { NOT_SET } from '../../ui/fieldCopy'
import { FIELD_LABEL, FIELD_ROW_BARE } from '../../ui/form/FieldRow'
import { OverlayClaim } from '../../ui/overlayClaim'
import type { PlaceMethod } from '../../usage/events'
import type { PlaceChoice } from './place'
import {
  CLEAR_PLACE,
  NO_PLACES_FOUND,
  PLACE_LABEL,
  PLACE_SEARCH_OFFLINE,
  PLACE_SEARCH_UNAVAILABLE,
  placeSearchBusy,
} from './recordingsCopy'

// The search endpoint's bounds on the text it takes.
const MIN_QUERY = 2
const MAX_QUERY = 100

interface Item {
  id: string
  choice: PlaceChoice
  /** The row's main line, and the line under it that tells same-named places apart. */
  title: string
  subtitle: string | null
  method: PlaceMethod
}

function outcomeMessage(outcome: PlaceSearchOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return NO_PLACES_FOUND
    case 'offline':
      return PLACE_SEARCH_OFFLINE
    case 'rate_limited':
      return placeSearchBusy(outcome.retryAfterSeconds)
    default:
      return PLACE_SEARCH_UNAVAILABLE
  }
}

/**
 * A recording's place as a field row that searches. Before the musician types it lists the
 * `recent` places; two or more characters search once the typing has settled for `settleMs`,
 * and only the latest search's answer shows. Clear removes the place, enabled while `canClear`
 * says there is one, which can be coordinates with no name to show.
 */
export function PlaceField({
  value,
  recent,
  canClear = value !== null,
  onChange,
  settleMs = 300,
}: {
  value: PlaceChoice | null
  recent: PlaceChoice[]
  canClear?: boolean
  onChange: (choice: PlaceChoice | null, method: PlaceMethod | null) => void
  settleMs?: number
}) {
  const engine = useSyncEngine()
  // Null until the musician types after focusing, so the field shows the place it holds.
  const [query, setQuery] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{
    ask: number
    term: string
    outcome: PlaceSearchOutcome
  } | null>(null)
  // The picked item, held only so React Aria closes the list on a pick.
  const [picked, setPicked] = useState<Key | null>(null)
  const latestAsk = useRef(0)

  const term = query !== null && query.trim().length >= MIN_QUERY ? query.trim() : null

  useEffect(() => {
    // Every change of term retires the search before it, so a slow answer never shows late.
    const ask = ++latestAsk.current
    if (term === null) return
    const timer = setTimeout(() => {
      void engine
        .searchPlaces(term)
        .catch((): PlaceSearchOutcome => ({ kind: 'failed' }))
        .then((outcome) => {
          if (ask === latestAsk.current) setAnswer({ ask, term, outcome })
        })
    }, settleMs)
    return () => clearTimeout(timer)
  }, [engine, term, settleMs])

  const statusId = useId()
  const outcome = term !== null && answer?.term === term ? answer.outcome : undefined
  const items: Item[] =
    term !== null
      ? outcome?.kind === 'ok'
        ? outcome.results.map(({ name, lat, lon, title, subtitle }, i) => ({
            id: `search-${answer?.ask}-${i}`,
            choice: { name, lat, lon },
            title,
            subtitle: subtitle ?? null,
            method: 'search',
          }))
        : []
      : recent
          .filter((place) => !query || containsText(place.name, query))
          .map((choice, i) => ({
            id: `recent-${i}`,
            choice,
            title: choice.name,
            subtitle: null,
            method: 'suggestion',
          }))
  const message = outcome && items.length === 0 ? outcomeMessage(outcome) : null

  const choose = (key: Key | null) => {
    setPicked(key)
    const item = items.find((i) => i.id === key)
    if (!item) return
    setQuery(null)
    setAnswer(null)
    onChange(item.choice, item.method)
  }

  const type = (text: string) => {
    // React Aria writes the picked item's text back when the same item is picked again.
    if (query === null && text === (value?.name ?? '')) return
    setQuery(text)
    setPicked(null)
  }

  return (
    <div className="flex flex-col">
      <div className={FIELD_ROW_BARE}>
        <ComboBox
          items={items}
          selectedKey={picked}
          onSelectionChange={choose}
          inputValue={query ?? value?.name ?? ''}
          onInputChange={type}
          allowsCustomValue
          menuTrigger="focus"
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Label className={`${FIELD_LABEL} ps-4`}>{PLACE_LABEL}</Label>
          <Input
            placeholder={NOT_SET}
            maxLength={MAX_QUERY}
            // Typing replaces the place rather than adding to its name.
            onFocus={(event) => event.currentTarget.select()}
            aria-describedby={statusId}
            onBlur={() => {
              setQuery(null)
              setAnswer(null)
            }}
            className="t-body placeholder:text-ink-2 min-h-(--target) min-w-0 flex-1 truncate bg-transparent text-end in-[html[data-density=touch]]:text-[max(16px,1rem)]"
          />
          {/* React Aria closes an empty list and opens it again once a search's results land. */}
          <Popover
            placement="bottom end"
            className="bg-ground max-h-80 min-w-48 overflow-y-auto rounded-(--radius-surface) p-1 shadow-(--shadow-float)"
          >
            <OverlayClaim />
            <ListBox className="outline-none">
              {(item: Item) => (
                <ListBoxItem
                  id={item.id}
                  textValue={item.title}
                  className="t-body data-[focused]:bg-fill flex min-h-(--target) cursor-default items-center rounded-(--radius-row) px-3 py-1"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Text slot="label" className="truncate">
                      {item.title}
                    </Text>
                    {item.subtitle && (
                      <Text slot="description" className="t-secondary text-ink-2 truncate">
                        {item.subtitle}
                      </Text>
                    )}
                  </span>
                </ListBoxItem>
              )}
            </ListBox>
          </Popover>
        </ComboBox>
        {/* Disabled rather than left out, so pressing it keeps the button, and its focus, in place. */}
        <span className="me-1 flex">
          <Button
            icon={X}
            iconOnly
            label={CLEAR_PLACE}
            isDisabled={!canClear}
            onPress={() => onChange(null, null)}
          />
        </span>
      </div>
      {/* Below the row rather than in the list, which stays closed with nothing to pick. Always
          in the tree, so a screen reader hears each message as it lands. */}
      <div id={statusId} role="status">
        {message && <p className="t-secondary text-ink-2 px-4 pb-2">{message}</p>}
      </div>
    </div>
  )
}
