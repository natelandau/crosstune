import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { updateTune } from '../../commands/tunes'
import { useDb } from '../../db/DbProvider'
import { useWakeLock } from '../../platform/wakeLock'
import { useAction } from '../../ui/useAction'
import { lyricLines } from './lyricLines'
import { LYRICS_STEPS, stepLyricsSize, useLyricsStep } from './lyricsSize'

export interface LyricsReader {
  verses: string[][]
  /** The text size step, 1 to `LYRICS_STEPS`, kept per device. */
  step: number
  atSmallest: boolean
  atLargest: boolean
  smaller: () => void
  larger: () => void
  /** The last step a press chose, for a live region; empty on each open. */
  announced: string
  /** Whether the words are open for editing. */
  editing: boolean
  setEditing: (editing: boolean) => void
  /** Writes the words on their own, and leaves editing once the write lands. */
  save: (text: string) => void
  /** A refused write, for the editor to show beside the words it kept. */
  error: string | null
  pending: boolean
}

/**
 * The lyrics reading view: the words as verses at the device's size step, and an editor that
 * writes them without a form. It keeps the screen awake while open, because a propped phone
 * that dims mid-tune drops the musician's place.
 */
export function useLyricsReader({
  open,
  tuneId,
  lyrics,
}: {
  open: boolean
  tuneId: string
  lyrics: string | null | undefined
}): LyricsReader {
  const db = useDb()
  const [editing, setEditing] = useState(false)
  const { error, pending, runThen, clear } = useAction()
  const step = useLyricsStep()
  const [announced, setAnnounced] = useState('')
  // A body runs to 20,000 characters, and every keystroke elsewhere on the screen re-renders
  // the reader, so it is parsed once per body.
  const verses = useMemo(() => lyricLines(lyrics), [lyrics])
  const atSmallest = step <= 1
  const atLargest = step >= LYRICS_STEPS
  useWakeLock(open)

  // Reported once per opening, when the words are first on screen: lyrics that sync in while
  // the reader is already open count, and a later edit does not report again.
  const analytics = useAnalytics()
  const reportedFor = useRef<string | null>(null)
  const wordsShown = open && verses.length > 0
  useEffect(() => {
    if (!open) reportedFor.current = null
    else if (wordsShown && reportedFor.current !== tuneId) {
      reportedFor.current = tuneId
      analytics.send('lyrics_opened', { tune_id: tuneId })
    }
  }, [open, wordsShown, tuneId, analytics])

  // Cleared during render, so the first frame of an opening is already silent: the live region
  // holds its last text for as long as it is mounted, and a reader exploring the view would
  // find the step announced the time before and read it as if it had just been said.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setAnnounced('')
      // The editor belongs to the reading it was opened from: a view that closes while it is
      // up would otherwise open straight into it the next time a musician asks to read.
      setEditing(false)
      clear()
    }
  }

  const move = (by: number) => {
    if (by < 0 ? atSmallest : atLargest) return
    const next = stepLyricsSize(by)
    setAnnounced(`Text size ${next} of ${LYRICS_STEPS}`)
  }

  const save = (text: string) => {
    const body = text.trim()
    runThen(
      () => updateTune(db, tuneId, { lyrics: body || null }),
      () => setEditing(false),
    )
  }

  return {
    verses,
    step,
    atSmallest,
    atLargest,
    smaller: () => move(-1),
    larger: () => move(1),
    announced,
    editing,
    setEditing,
    save,
    error,
    pending,
  }
}
