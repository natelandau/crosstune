import { useMemo, useRef, useState } from 'react'
import type { Instrument } from '../../api/vocabulary'
import { removeFromList } from '../../commands/lists'
import { deleteTune, setArchived } from '../../commands/tunes'
import { useDb } from '../../db/DbProvider'
import type { LocalUserTune } from '../../db/types'
import type { MenuItem } from '../../ui/menuTypes'
import { DELETE } from '../../ui/confirmCopy'
import { useAction } from '../../ui/useAction'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { useDeleteAndLeave } from '../../ui/useDeleteAndLeave'
import { useLatest } from '../../ui/useLatest'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import { useActiveLists, useMembership } from '../lists/useLists'
import { lyricOpening } from '../lyrics/lyricLines'
import { useRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import { tuningDisplay, tuningInstruments, tuningKey } from '../settings/instruments'
import { useInstruments } from '../settings/useInstruments'
import { ARCHIVE, UNARCHIVE } from './archiveLabels'
import { DELETE_TUNE_TITLE, deleteTuneMessage } from './deleteTuneMessage'
import { useTune, type TuneView } from './useTune'

export interface TuneBadge {
  field: string
  label: string
}

/** What a tune says about itself in its header, ready to draw. */
export interface TuneFacts {
  title: string
  alternateTitles: string[]
  composer: string | null
  key: string | null
  modes: string[]
  status: LocalUserTune['status']
  archived: boolean
  /** True only for words: whitespace alone would open a reading view on a blank page. */
  hasLyrics: boolean
}

export interface TuneListMembership {
  id: string
  name: string
  /** The list item that removes the tune from this list. */
  itemId: string
}

export interface TuneScreenData {
  /** The live tune; undefined while it loads and once it is gone. */
  tune: TuneView | undefined
  /** True once the tune's row is gone, whether it never existed or was deleted on another
   * device. False while loading and while this screen's own confirmed delete runs. */
  missing: boolean
  /** True once the tune, the instruments, and the tune's recordings have all been read. */
  ready: boolean
  /** The instruments the user plays; undefined until the settings row is read. */
  instruments: ReadonlySet<Instrument> | undefined
  recordings: readonly RecordingView[] | undefined
  facts: TuneFacts | null
  badges: TuneBadge[]
  /** The learned-on date as a local calendar date, or null when none is set. */
  learnedOn: string | null
  learnedFrom: string | null
  /** True when either who or when it was learned is set. */
  learned: boolean
  notes: string | null
  inLists: TuneListMembership[]
  /** The tune's user row id as a one-item list, stable across renders for a list picker. */
  pickerTuneIds: string[]
  /** The one error line: a failed action or a failed delete, whichever spoke last. */
  error: string | null
  /** True while an action is in flight. */
  pending: boolean
  /** The title of a tune whose confirmed delete is running. */
  deletingName: string | null
  removeFromList: (itemId: string) => void
  /** Add to list, Archive or Unarchive, and Delete, in the order a menu shows them. */
  menuFor: (onAddToList: () => void) => MenuItem[]
}

/**
 * Everything a tune page reads and does, as data and callbacks. `leave` runs once a confirmed
 * delete lands.
 */
export function useTuneScreen(
  tuneId: string,
  {
    confirm,
    leave,
  }: {
    confirm: (question: ConfirmQuestion) => Promise<boolean>
    leave: () => void
  },
): TuneScreenData {
  const db = useDb()
  const view = useTune(tuneId)
  const instruments = useInstruments()
  const recordings = useRecordingsWithFiles({ tuneId })
  const lists = useActiveLists()
  const userTuneId = view?.userTune.id
  const membership = useMembership(userTuneId ?? '')
  const action = useAction()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletion = useDeleteAndLeave({
    confirm,
    remove: () => deleteTune(db, tuneId),
    leave,
    onStart: () => {
      setDeleteError(null)
      action.clear()
    },
    onError: setDeleteError,
    subject: tuneId,
  })
  useResetOnChange(tuneId, () => {
    setDeleteError(null)
    action.clear()
  })
  const deleted = deletion.deletingName !== null
  const pickerTuneIds = useMemo(() => (userTuneId ? [userTuneId] : []), [userTuneId])
  // A body runs to 20,000 characters, and a page re-renders on every change to the tune.
  const lyrics = view?.tune.lyrics
  const hasLyrics = useMemo(() => lyricOpening(lyrics, 1).length > 0, [lyrics])
  const ready = view !== undefined && instruments !== undefined && recordings !== undefined

  const tuneRef = useLatest(tuneId)
  const run = (work: () => Promise<unknown>) => {
    const mine = tuneId
    setDeleteError(null)
    // A refusal that lands after another tune opened belongs to the old one.
    action.run(async () => {
      try {
        await work()
      } catch (caught) {
        if (tuneRef.current === mine) throw caught
      }
    })
  }

  // A ref rather than state: two presses in one tick both read the same committed state.
  const removing = useRef(new Set<string>())
  const removeItem = (itemId: string) => {
    if (removing.current.has(itemId)) return
    removing.current.add(itemId)
    run(async () => {
      try {
        await removeFromList(db, itemId)
      } finally {
        removing.current.delete(itemId)
      }
    })
  }

  const menuFor = (onAddToList: () => void): MenuItem[] => {
    if (!view) return []
    const archived = view.userTune.archived_at !== null
    return [
      { label: ADD_TO_LIST, onPress: onAddToList },
      {
        label: archived ? UNARCHIVE : ARCHIVE,
        tone: 'warning',
        onPress: () => run(() => setArchived(db, view.userTune.id, !archived)),
      },
      {
        label: DELETE,
        tone: 'error',
        onPress: () =>
          void deletion.start(view.tune.title, {
            title: DELETE_TUNE_TITLE,
            message: deleteTuneMessage(view.tune.title, recordings ?? []),
            action: DELETE,
          }),
      },
    ]
  }

  return {
    tune: view ?? undefined,
    missing: view === null && !deleted,
    ready,
    instruments,
    recordings,
    facts: view
      ? {
          title: view.tune.title,
          alternateTitles: view.tune.alternate_titles,
          composer: view.tune.composer || null,
          key: view.tune.key || null,
          modes: view.tune.modes,
          status: view.userTune.status,
          archived: view.userTune.archived_at !== null,
          hasLyrics,
        }
      : null,
    badges: view && instruments ? badgesFor(view, instruments) : [],
    learnedOn: view?.userTune.learned_on ? formatLearnedOn(view.userTune.learned_on) : null,
    learnedFrom: view?.userTune.learned_from ?? null,
    learned: view
      ? view.userTune.learned_from !== null || view.userTune.learned_on !== null
      : false,
    notes: view?.userTune.notes || null,
    inLists: (lists ?? []).flatMap((list) => {
      const itemId = membership.get(list.id)
      return itemId ? [{ id: list.id, name: list.name, itemId }] : []
    }),
    pickerTuneIds,
    error: deleteError ?? action.error,
    pending: action.pending,
    deletingName: deletion.deletingName,
    removeFromList: removeItem,
    menuFor,
  }
}

function badgesFor(
  { tune }: TuneView,
  instruments: NonNullable<ReturnType<typeof useInstruments>>,
): TuneBadge[] {
  return [
    // Two instruments can share a tuning's name, so each badge names its instrument.
    ...tuningInstruments(instruments, tune).map((instrument) => ({
      field: tuningKey(instrument),
      label: tuningDisplay(instrument, tune.tunings, { withInstrument: true }),
    })),
    { field: 'time_signature', label: tune.time_signature },
    { field: 'is_crooked', label: tune.is_crooked ? 'Crooked' : null },
    { field: 'tune_type', label: tune.tune_type },
    { field: 'genre', label: tune.genre },
    { field: 'part_structure', label: tune.part_structure },
  ].filter((badge): badge is TuneBadge => Boolean(badge.label))
}

const LEARNED_ON_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** A stored YYYY-MM-DD read as a local calendar date, so no timezone moves it a day. */
function formatLearnedOn(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return LEARNED_ON_FORMAT.format(new Date(Number(year), Number(month) - 1, Number(day)))
}
