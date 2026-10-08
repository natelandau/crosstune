import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import { liveTune } from '../../db/tunes'
import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import { displayTitle } from '../links/display'
import { recordingTitle } from '../recordings/recordingRow'
import { embedFor, type Embed } from './embed'
import { usePlayer } from './usePlayer'
import type { PlayerItem } from '../../domain/playerItem'

/** What the player shows: a link and its embed, or a recording and what titles it. */
export type DockShown =
  | { kind: 'link'; link: LocalRecordingLink; embed: Embed }
  | {
      kind: 'recording'
      recording: LocalRecording
      file: RecordingFile | null
      tuneTitle: string | null
    }

export interface DockRead {
  item: PlayerItem
  link: LocalRecordingLink | null
  recording: LocalRecording | null
  file: RecordingFile | null
  tuneTitle: string | null
}

export interface DockItem {
  /** The settled read for the loaded item; undefined while it is pending or nothing is loaded. */
  current: DockRead | undefined
  /** The loaded link, when it is live. */
  link: LocalRecordingLink | null
  /** The loaded recording, when it is live. */
  recording: LocalRecording | null
  file: RecordingFile | null
  tuneTitle: string | null
  embed: Embed | null
  /** The shown item's title; empty when nothing is shown. */
  title: string
  /** What to show, held through a pending read of a replacement; null hides the player. */
  shown: DockShown | null
}

function shownEquals(a: DockShown | null, b: DockShown | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.kind === 'link' && b.kind === 'link') return a.link === b.link && a.embed === b.embed
  if (a.kind === 'recording' && b.kind === 'recording')
    return a.recording === b.recording && a.file === b.file && a.tuneTitle === b.tuneTitle
  return false
}

/**
 * Reads the player's loaded item and decides what the player shows. Closes the player when the
 * item cannot play: a link with no embed, or a recording that is missing or deleted.
 */
export function useDockItem(): DockItem {
  const db = useDb()
  const { item, close } = usePlayer()

  // Tagging the result with its item keeps a read for the previous item from being
  // taken as the answer for the new one while the new read is pending.
  const loaded = useLiveQuery(async (): Promise<DockRead | null> => {
    if (item === null) return null
    if (item.kind === 'link') {
      return {
        item,
        link: (await db.recording_links.get(item.id)) ?? null,
        recording: null,
        file: null,
        tuneTitle: null,
      }
    }
    const recording = (await db.recordings.get(item.id)) ?? null
    const tune = recording?.tune_id ? await db.tunes.get(recording.tune_id) : null
    return {
      item,
      link: null,
      recording,
      file: (await db.recording_files.get(item.id)) ?? null,
      tuneTitle: liveTune(tune)?.title ?? null,
    }
  }, [db, item])
  const current = loaded && loaded.item === item ? loaded : undefined
  const link = current?.link && !current.link.deleted_at ? current.link : null
  const recording = current?.recording && !current.recording.deleted_at ? current.recording : null
  const file = current?.file ?? null
  const tuneTitle = current?.tuneTitle ?? null
  // Every item reaches the player from a Play tap, so the player always starts playing.
  const embed = useMemo(() => (link ? embedFor(link, { autoplay: true }) : null), [link])
  // A recording has no embed to fail; a missing or deleted row is what closes it instead.
  const unplayable = current !== undefined && item?.kind === 'link' && embed === null
  const missingRecording = current !== undefined && item?.kind === 'recording' && recording === null

  // Holding the last playable item through a replacement read keeps the player and its
  // reserved room mounted, so the page height and scroll position do not jump.
  const [shown, setShown] = useState<DockShown | null>(null)
  const resolved: DockShown | null =
    link && embed
      ? { kind: 'link', link, embed }
      : recording
        ? { kind: 'recording', recording, file, tuneTitle }
        : null
  const fresh = resolved ?? (item !== null && current === undefined ? shown : null)
  // The held object while nothing it holds has changed, so `shown` keeps its identity across
  // renders and a caller can memoize on it.
  const same = shownEquals(fresh, shown)
  if (!same) setShown(fresh)
  const next = same ? shown : fresh

  useEffect(() => {
    if (unplayable || missingRecording) close()
  }, [unplayable, missingRecording, close])

  const title =
    next === null
      ? ''
      : next.kind === 'link'
        ? displayTitle(next.link)
        : recordingTitle({
            recording: next.recording,
            file: next.file ?? undefined,
            tuneId: null,
            tuneTitle: next.tuneTitle,
          })

  return { current, link, recording, file, tuneTitle, embed, title, shown: next }
}
