import { MapPin } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PlaceHint } from '../../../api/types'
import { PLACE_LIMITS } from '../../../api/vocabulary'
import type { MapKit, MapKitMap } from '../../../platform/mapkit'
import { useMapKitState } from '../../../platform/useMapKit'
import type { PlaceReverseOutcome } from '../../../sync/types'
import { useScheme } from '../../../theme/useScheme'
import { MapMessage, useMapMessage } from '../../../ui/LocationMap'
import { useEnterKey } from '../../../ui/attributes/AttributeEditor'
import { Button } from '../../../ui/Button'
import { Group } from '../../../ui/form/Group'
import { TextField } from '../../../ui/form/TextField'
import { mapOptions, regionAround } from '../../../ui/mapRegion'
import { useLatest } from '../../../ui/useLatest'
import {
  LOCATION_NAME_LABEL,
  LOCATION_SEARCH_OFFLINE,
  LOCATION_SEARCH_UNAVAILABLE,
  locationSearchBusy,
  NAME_LOCATION_HELP,
} from '../../recordings/recordingsCopy'
import { MOVE_THE_MAP, USE_THIS_SPOT } from './locationEditorCopy'
import { useReversePlace, type ReverseAnswers } from './useReversePlace'

/** The spot under the pin as the musician uses it. */
export type PinSpot = {
  lat: number
  lon: number
  /** The address the server gave the spot, empty when it gave none; the server names it later. */
  name: string
  /** The spot's whole address, when the server gave one. */
  address: string | null
  /** A name typed for a saved location there, null for none. */
  savedName: string | null
}

/** The whole world, for a pin with nowhere better to start. */
const worldRegion = (mapkit: MapKit) =>
  new mapkit.CoordinateRegion(new mapkit.Coordinate(20, 0), new mapkit.CoordinateSpan(140, 360))

/** Why a lookup gave no address, when the musician can do something about it. */
function lookupMessage(outcome: PlaceReverseOutcome | null): string | null {
  switch (outcome?.kind) {
    case 'offline':
      return LOCATION_SEARCH_OFFLINE
    case 'unavailable':
      return LOCATION_SEARCH_UNAVAILABLE
    case 'rate_limited':
      return locationSearchBusy(outcome.retryAfterSeconds)
    default:
      return null
  }
}

/**
 * A map with a pin fixed at its center, which the musician moves the map under. The spot under
 * the pin is named once the map settles; Use this spot hands it to `onUse` with any name typed.
 * `start` null opens on the whole world, with no spot until the map moves.
 */
export function DropPin({
  start,
  known,
  onUse,
}: {
  start: PlaceHint | null
  /** The lookups answered for good while the editor is open. */
  known: ReverseAnswers
  onUse: (spot: PinSpot) => void
}) {
  const [point, setPoint] = useState<PlaceHint | null>(start)
  const [savedName, setSavedName] = useState('')
  const outcome = useReversePlace(point, known)
  const place = outcome?.kind === 'ok' ? outcome.place : null
  const message = lookupMessage(outcome)

  const pick = () => {
    if (!point) return
    onUse({
      lat: point.lat,
      lon: point.lon,
      name: place?.name ?? '',
      address: place?.address ?? null,
      savedName: savedName.trim() || null,
    })
  }
  // Enter in the name field uses the spot, rather than closing the editor.
  useEnterKey(pick)

  return (
    <div className="pb-4">
      <PinMap start={start} onSettle={setPoint} />
      <Group footer={NAME_LOCATION_HELP}>
        <div className="flex min-h-(--target) flex-col justify-center px-4 py-2">
          <span className="t-secondary text-secondary">{MOVE_THE_MAP}</span>
          {/* Always in the tree, so a screen reader hears each address as the map settles. */}
          <span role="status" className="flex flex-col">
            {place && <span className="t-body ph-no-capture">{place.name}</span>}
            {message && <span className="t-secondary text-secondary">{message}</span>}
          </span>
        </div>
        <TextField
          label={LOCATION_NAME_LABEL}
          value={savedName}
          maxLength={PLACE_LIMITS.name}
          enterKeyHint="done"
          onChange={setSavedName}
        />
      </Group>
      <div className="pt-4">
        <Button
          variant="primary"
          label={USE_THIS_SPOT}
          fullWidth
          isDisabled={!point}
          onPress={pick}
        />
      </div>
    </div>
  )
}

/**
 * The movable map under a fixed pin. It reports the center once the musician has moved the map
 * and it has stopped, never for the region it opens on.
 */
function PinMap({
  start,
  onSettle,
}: {
  start: PlaceHint | null
  onSettle: (point: PlaceHint) => void
}) {
  const { mapkit, status } = useMapKitState()
  const scheme = useScheme()
  const element = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const onSettleRef = useLatest(onSettle)
  // Where the map is, so a map drawn again for a new scheme opens where the musician left it.
  const at = useRef(start)

  useEffect(() => {
    if (!mapkit || !element.current) return
    let map: MapKitMap
    try {
      map = new mapkit.Map(element.current, mapOptions(scheme))
      const from = at.current
      map.region = from ? regionAround(mapkit, from.lat, from.lon) : worldRegion(mapkit)
    } catch {
      // Deferred so the effect makes no synchronous state write.
      queueMicrotask(() => setFailed(true))
      return
    }
    // MapKit also reports the region it was given, which is not a spot the musician chose.
    let moved = false
    const onMove = () => {
      moved = true
    }
    const onEnd = () => {
      if (!moved) return
      const { latitude, longitude } = map.center
      at.current = { lat: latitude, lon: longitude }
      onSettleRef.current(at.current)
    }
    map.addEventListener('scroll-start', onMove)
    map.addEventListener('zoom-start', onMove)
    map.addEventListener('region-change-end', onEnd)
    return () => {
      try {
        map.removeEventListener('scroll-start', onMove)
        map.removeEventListener('zoom-start', onMove)
        map.removeEventListener('region-change-end', onEnd)
        map.destroy()
      } catch {
        // A map that cannot be torn down has nothing left to lose.
      }
    }
  }, [mapkit, scheme, onSettleRef])

  const message = useMapMessage(status, failed)
  if (message) {
    return (
      <div className="mt-2">
        <MapMessage message={message} height="max(280px, 50dvh)" />
      </div>
    )
  }
  if (!mapkit || failed) return null
  return (
    // A drag on the map moves the map, never the sheet around it.
    <div
      className="relative mt-2 h-[max(280px,50dvh)] overflow-hidden rounded-lg"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div ref={element} className="ph-no-capture size-full" />
      <MapPin
        className="text-accent pointer-events-none absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-full"
        aria-hidden
      />
    </div>
  )
}
