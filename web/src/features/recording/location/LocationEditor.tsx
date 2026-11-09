import { Bookmark, History, LocateFixed, MapPin, type LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PlaceHint } from '../../../api/types'
import type { LocalPlace } from '../../../db/types'
import { metersFrom } from '../../../domain/placeDistances'
import { containsText } from '../../../text/fold'
import {
  AttributeEditor,
  useEnterKey,
  type AttributeEditorFrame,
} from '../../../ui/attributes/AttributeEditor'
import { Button } from '../../../ui/Button'
import { ButtonRow } from '../../../ui/form/ButtonRow'
import { PressableRow } from '../../../ui/PressableRow'
import { Group } from '../../../ui/form/Group'
import { LocationMap } from '../../../ui/LocationMap'
import { Tabs } from '../../../ui/Tabs'
import { useAnalytics } from '../../../usage/AnalyticsProvider'
import { LocationList, LocationRow, PlaceSearch } from '../../recordings/LocationRows'
import { NameLocationForm } from '../../recordings/NameLocationForm'
import { mapsUrl, samePlace, type PlaceChoice } from '../../recordings/place'
import {
  CLEAR_LOCATION,
  CURRENT_LOCATION,
  LOCATION_ACCESS_OFF,
  LOCATION_LABEL,
  LOCATION_NAME_LABEL,
  LOCATION_SEARCH_UNAVAILABLE,
  NAME_LOCATION_HELP,
  NAME_LOCATION_TITLE,
  NAME_THIS_LOCATION,
  NEARBY_LOCATIONS,
  NO_NEARBY_LOCATIONS,
  OPEN_IN_MAPS,
  RECENT_LOCATIONS,
  RENAME_THIS_LOCATION,
  SAVED_LOCATIONS,
} from '../../recordings/recordingsCopy'
import { namingCandidates, nearbyRows } from '../../recordings/stagedPlace'
import { useNearbyLookup } from '../../recordings/useNearbyPlaces'
import { usePlaceSearch, type PlaceSearchState } from '../../recordings/usePlaceSearch'
import type { RecordingView } from '../../recordings/useRecordings'
import { SAVED_LOCATION_NAME_HELP } from '../../settings/settingsCopy'
import {
  useSavedLocationActions,
  type SavedLocationActions,
} from '../../settings/useSavedLocations'
import { formatDistance } from './distance'
import { DropPin } from './DropPin'
import type { ReverseAnswers } from './useReversePlace'
import {
  CANT_FIND_IT,
  DROP_A_PIN,
  FIND_A_PLACE,
  NO_CURRENT_LOCATION,
  USE_CURRENT_LOCATION,
} from './locationEditorCopy'
import { useLocationEditor, type LocationEditorState, type PlaceList } from './useLocationEditor'
import { renameTo } from './renameTo'

/** The map here is taller than the recording page's, so the spot reads before a pick. */
const MAP_HEIGHT = 280

const LISTS: readonly PlaceList[] = ['nearby', 'saved', 'recent']
const LIST_ICONS: Record<PlaceList, LucideIcon> = {
  nearby: MapPin,
  saved: Bookmark,
  recent: History,
}
const LIST_NAMES: Record<PlaceList, string> = {
  nearby: NEARBY_LOCATIONS,
  saved: SAVED_LOCATIONS,
  recent: RECENT_LOCATIONS,
}

/** The naming and rename steps hold the name typed, which every dismissal but Escape and Cancel keeps. */
type EditorStep =
  | { kind: 'naming'; name: string }
  | { kind: 'renaming'; name: string }
  | { kind: 'pin'; start: PlaceHint | null }

/** How the sheet frames each step: its title, and its height on touch. */
const STEP_FRAMES: Record<
  EditorStep['kind'],
  Omit<NonNullable<AttributeEditorFrame['step']>, 'back'>
> = {
  naming: { title: NAME_LOCATION_TITLE },
  renaming: { title: RENAME_THIS_LOCATION },
  pin: { height: 'full' },
}

/**
 * The Location row's editor: a sheet on every frame, since it holds a map and lists. Search
 * comes first; picks are held while it shows, and every dismissal writes them, Done included,
 * with any saved location they make. A name typed on the naming or rename step and not yet
 * entered is kept the same way, as Enter would keep it. Only Escape and Cancel discard them.
 */
export function LocationEditor({
  view,
  isOpen,
  onOpenChange,
  onClosed,
  run,
}: {
  view: RecordingView
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Runs once the sheet has finished closing. The caller mounts a fresh editor for each opening,
   * so every one starts with nothing picked.
   */
  onClosed?: () => void
  /** Runs the write a dismissal starts, so its refusal shows where the page shows its others. */
  run: (save: () => Promise<void>) => void
}) {
  const editor = useLocationEditor(view)
  // Shared with the rename step, so a dismissal's rename waits for one the step started.
  const savedLocations = useSavedLocationActions()
  // The second page shown in place of the editor's own, if any; the pin drop holds where it opens.
  const [step, setStep] = useState<EditorStep | null>(null)
  // Back puts focus on the search itself, rather than leaving it to the dialog, which can look
  // for a field before the editor's own page has drawn.
  const [returned, setReturned] = useState(false)
  const back = () => {
    setStep(null)
    setReturned(true)
  }
  // Held here, so a second page returns to the search as it was left.
  const [query, setQuery] = useState('')
  const search = usePlaceSearch(query, editor.hint)
  const [known] = useState<ReverseAnswers>(() => new Map())
  // A sheet on every frame never anchors to its row.
  const noAnchor = useRef<HTMLElement>(null)
  const typed = step?.kind === 'naming' || step?.kind === 'renaming' ? step.name.trim() : ''
  const named = step?.kind === 'naming' && typed !== '' ? typed : null
  const linked = editor.linkedPlace
  const renamedTo = step?.kind === 'renaming' && linked ? renameTo(linked.name, step.name) : null
  const renamed = linked && renamedTo !== null ? { id: linked.id, name: renamedTo } : null
  const save = () =>
    run(async () => {
      await Promise.all([
        renamed && savedLocations.commitRename(renamed.id, renamed.name),
        editor.save(named ?? undefined),
      ])
    })
  const setName = (name: string) =>
    setStep((now) => (now && now.kind !== 'pin' ? { ...now, name } : now))
  return (
    <AttributeEditor
      label={LOCATION_LABEL}
      triggerRef={noAnchor}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onClosed={onClosed}
      dirty={editor.changed || named !== null || renamed !== null}
      onSave={save}
      forceSheet
      sheetHeight="full"
      cancelable={step?.kind !== 'pin'}
      step={step ? { ...STEP_FRAMES[step.kind], back } : undefined}
    >
      {step?.kind === 'naming' && (
        <NamingStep editor={editor} name={step.name} onNameChange={setName} onDone={back} />
      )}
      {step?.kind === 'renaming' && (
        <RenamingStep
          editor={editor}
          actions={savedLocations}
          name={step.name}
          onNameChange={setName}
          onDone={back}
        />
      )}
      {step?.kind === 'pin' && (
        <DropPin
          start={step.start}
          known={known}
          onUse={(spot) => {
            editor.pickPin(spot)
            // A pick ends the search, as a result's does, so the place picked shows.
            setQuery('')
            back()
          }}
        />
      )}
      {step === null && (
        <EditorBody
          editor={editor}
          query={query}
          onQueryChange={setQuery}
          search={search}
          focusSearch={returned}
          onName={() => setStep({ kind: 'naming', name: '' })}
          onRename={() => setStep({ kind: 'renaming', name: editor.linkedPlace?.name ?? '' })}
          onDropPin={() => setStep({ kind: 'pin', start: editor.pinStart(search.area) })}
        />
      )}
    </AttributeEditor>
  )
}

interface NameStepProps {
  editor: LocationEditorState
  name: string
  onNameChange: (name: string) => void
  onDone: () => void
}

/** Names the recording's point, as a saved location there or a new one, then steps back. */
function NamingStep({ editor, name, onNameChange, onDone }: NameStepProps) {
  return (
    <NameStep
      name={name}
      onNameChange={onNameChange}
      help={NAME_LOCATION_HELP}
      candidates={namingCandidates(editor.placePoint, editor.savedPlaces)}
      onPick={(place) => {
        editor.pickSaved(place, { whileNaming: true })
        onDone()
      }}
      onSubmit={() => {
        editor.nameLocation(name)
        onDone()
      }}
    />
  )
}

/**
 * Renames the saved location the place is, at once and as Settings does, so every recording
 * linked to it follows; the editor's own Escape keeps the new name. Back drops the typing.
 */
function RenamingStep({
  editor,
  actions: { rename, failure },
  name,
  onNameChange,
  onDone,
}: NameStepProps & { actions: SavedLocationActions }) {
  const placeId = editor.linkedPlace?.id
  return (
    <NameStep
      name={name}
      onNameChange={onNameChange}
      help={SAVED_LOCATION_NAME_HELP}
      error={failure ?? undefined}
      onSubmit={async () => {
        if (placeId && (await rename(placeId, name))) onDone()
      }}
    />
  )
}

/** A step that takes a location's name; Enter submits it, rather than closing the editor. */
function NameStep({
  name,
  onNameChange,
  help,
  error,
  candidates,
  onPick,
  onSubmit,
}: {
  name: string
  onNameChange: (name: string) => void
  help: string
  error?: string
  candidates?: LocalPlace[]
  onPick?: (place: LocalPlace) => void
  onSubmit: () => void | Promise<void>
}) {
  const submit = () => void onSubmit()
  useEnterKey(submit)
  return (
    <NameLocationForm
      candidates={candidates}
      name={name}
      help={help}
      error={error}
      onNameChange={onNameChange}
      onPick={onPick}
      onSubmit={submit}
    />
  )
}

function EditorBody({
  editor,
  query,
  onQueryChange: setQuery,
  search,
  focusSearch,
  onName,
  onRename,
  onDropPin,
}: {
  editor: LocationEditorState
  /** The search's text, kept by the editor across its second pages. */
  query: string
  onQueryChange: (query: string) => void
  /** The search for `query`, kept by the editor across its second pages. */
  search: PlaceSearchState
  /** Focuses the search as it shows, as it does anyway for a recording with no place. */
  focusSearch: boolean
  onName: () => void
  onRename: () => void
  onDropPin: () => void
}) {
  // With no Enter key of its own, Enter in the search never closes the editor; a result is
  // picked by pressing it.
  const searching = query.trim() !== ''
  const { center } = editor
  const distanceOf = (at: { lat: number; lon: number }) =>
    center ? formatDistance(metersFrom(center, at)) : null

  const savedMatches = searching
    ? editor.savedPlaces.filter((place) => containsText(place.name, query.trim()))
    : []
  const linkedId = editor.linkedPlace?.id ?? null
  // A pick ends the search, so the place picked shows.
  const pickThenClear = (pick: () => void) => {
    pick()
    setQuery('')
  }

  return (
    <div className="pb-4">
      <PlaceSearch
        label={FIND_A_PLACE}
        query={query}
        onQueryChange={setQuery}
        search={search}
        distanceOf={distanceOf}
        autoFocus={focusSearch || editor.placePoint === null}
        onPick={(result) => pickThenClear(() => editor.pickSearch(result))}
      >
        {savedMatches.length > 0 && (
          <LocationList label={SAVED_LOCATIONS} showLabel selectedId={linkedId}>
            {savedMatches.map((place) => (
              <LocationRow
                key={place.id}
                id={place.id}
                name={place.name}
                detail={place.address}
                distance={distanceOf(place)}
                onPress={() => pickThenClear(() => editor.pickSaved(place))}
              />
            ))}
          </LocationList>
        )}
        <Group>
          <PressableRow onPress={onDropPin} className="py-2">
            <span className="min-w-0 flex-1">
              <span className="text-secondary">{CANT_FIND_IT}</span>{' '}
              <span className="text-accent font-medium">{DROP_A_PIN}</span>
            </span>
          </PressableRow>
        </Group>
      </PlaceSearch>
      {/* Hidden rather than unmounted while a search shows, so the map and Nearby's answer stay. */}
      <div hidden={searching}>
        <PlaceDetails editor={editor} onName={onName} onRename={onRename} />
      </div>
    </div>
  )
}

/** Everything under the search while it is empty: the place now, and places to pick. */
function PlaceDetails({
  editor,
  onName,
  onRename,
}: {
  editor: LocationEditorState
  onName: () => void
  onRename: () => void
}) {
  const analytics = useAnalytics()
  const at = editor.placePoint
  return (
    <>
      <Group
        plain
        footer={
          editor.locationOff ? LOCATION_ACCESS_OFF : editor.noFix ? NO_CURRENT_LOCATION : undefined
        }
      >
        <div className="px-4">
          <Button
            variant="secondary"
            icon={LocateFixed}
            label={USE_CURRENT_LOCATION}
            isDisabled={editor.locationOff}
            onPress={editor.pickCurrentLocation}
          />
        </div>
      </Group>
      {at && (
        <div className="pt-4">
          <LocationMap lat={at.lat} lon={at.lon} accuracyM={at.accuracyM} height={MAP_HEIGHT} />
        </div>
      )}
      {at && (
        <Group header={CURRENT_LOCATION}>
          {editor.place?.name && (
            <div className="flex min-h-(--size-row) flex-col justify-center px-4 py-2">
              <span className="t-body ph-no-capture">{editor.place.name}</span>
              {editor.placeAddress && (
                <span className="t-secondary text-secondary ph-no-capture">
                  {editor.placeAddress}
                </span>
              )}
            </div>
          )}
          {editor.canNamePlace && (
            <ButtonRow
              title={LOCATION_NAME_LABEL}
              description={NAME_LOCATION_HELP}
              button={{ label: NAME_THIS_LOCATION, onPress: onName }}
            />
          )}
          {editor.canRenamePlace && (
            <ButtonRow
              title={LOCATION_NAME_LABEL}
              button={{ label: RENAME_THIS_LOCATION, onPress: onRename }}
            />
          )}
          {editor.mapsPoint && (
            <PressableRow
              href={mapsUrl(editor.mapsPoint, editor.place?.name ?? null)}
              onClick={() => analytics.send('location_opened_in_maps', {})}
              className="text-primary font-medium"
            >
              <span className="min-w-0 flex-1">{OPEN_IN_MAPS}</span>
            </PressableRow>
          )}
          <ButtonRow
            title={LOCATION_LABEL}
            button={{ label: CLEAR_LOCATION, variant: 'destructive', onPress: editor.clearPlace }}
          />
        </Group>
      )}
      <PlaceLists editor={editor} />
    </>
  )
}

/** Nearby, Saved, and Recent under one switch, showing the list the editor holds. */
function PlaceLists({ editor }: { editor: LocationEditorState }) {
  const shown = editor.list
  return (
    <div className="pt-6">
      <Tabs
        label={LOCATION_LABEL}
        tabs={LISTS.map((list) => ({ id: list, label: LIST_NAMES[list], icon: LIST_ICONS[list] }))}
        selected={shown}
        onChange={editor.chooseList}
        container="page"
        panelClassName="pt-3"
      >
        {(list) => (
          <>
            {list === 'nearby' && <NearbyList editor={editor} />}
            {list === 'saved' && <SavedList editor={editor} />}
            {list === 'recent' && <RecentList editor={editor} />}
          </>
        )}
      </Tabs>
    </div>
  )
}

function NearbyList({ editor }: { editor: LocationEditorState }) {
  const { center } = editor
  const linkedId = editor.linkedPlace?.id ?? null
  const lookup = useNearbyLookup(center && { lat: center.lat, lon: center.lon })
  const rows = nearbyRows(
    center,
    editor.savedPlaces,
    lookup.status === 'found' ? lookup.places : null,
  )
  if (lookup.status === 'loading') return null
  if (lookup.status === 'unavailable' || rows.length === 0) {
    return (
      <div role="status">
        <p className="t-secondary text-secondary px-4 pt-2">
          {lookup.status === 'unavailable' ? LOCATION_SEARCH_UNAVAILABLE : NO_NEARBY_LOCATIONS}
        </p>
      </div>
    )
  }
  return (
    <LocationList label={NEARBY_LOCATIONS} selectedId={linkedId && `saved-${linkedId}`}>
      {rows.map((row) =>
        row.kind === 'saved' ? (
          <LocationRow
            key={`saved-${row.place.id}`}
            id={`saved-${row.place.id}`}
            name={row.place.name}
            detail={row.place.address}
            distance={formatDistance(row.meters)}
            onPress={() => editor.pickNearby(row)}
          />
        ) : (
          <LocationRow
            key={`venue-${row.venue.applePlaceId ?? `${row.venue.lat},${row.venue.lon}`}`}
            id={`venue-${row.venue.applePlaceId ?? `${row.venue.lat},${row.venue.lon}`}`}
            name={row.venue.name}
            detail={row.venue.address}
            distance={formatDistance(row.meters)}
            onPress={() => editor.pickNearby(row)}
          />
        ),
      )}
    </LocationList>
  )
}

function SavedList({ editor }: { editor: LocationEditorState }) {
  const linkedId = editor.linkedPlace?.id ?? null
  if (editor.savedPlaces.length === 0) return null
  return (
    <LocationList label={SAVED_LOCATIONS} selectedId={linkedId}>
      {editor.savedPlaces.map((place: LocalPlace) => (
        <LocationRow
          key={place.id}
          id={place.id}
          name={place.name}
          detail={place.address}
          onPress={() => editor.pickSaved(place)}
        />
      ))}
    </LocationList>
  )
}

function RecentList({ editor }: { editor: LocationEditorState }) {
  const isCurrent = (place: PlaceChoice) =>
    editor.linkedPlace === null && editor.place !== null && samePlace(editor.place, place)
  const places = editor.recentPlaces()
  if (places.length === 0) return null
  const idOf = (place: PlaceChoice) => `${place.name}|${place.lat},${place.lon}`
  const current = places.find(isCurrent)
  return (
    <LocationList label={RECENT_LOCATIONS} selectedId={current ? idOf(current) : null}>
      {places.map((place) => (
        <LocationRow
          key={idOf(place)}
          id={idOf(place)}
          name={place.name}
          onPress={() => editor.pickRecent(place)}
        />
      ))}
    </LocationList>
  )
}
