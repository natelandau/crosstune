import { useEffect, useRef, useState } from 'react'
import { TUNE_LIMITS } from '../../api/vocabulary'
import { updateUserTune } from '../../commands/tunes'
import { useDb } from '../../db/DbProvider'
import { ErrorLine } from '../../ui/ErrorLine'
import { TextField } from '../../ui/form/TextField'
import { useAction } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { Button } from '../../ui/Button'
import { DONE } from '../../ui/confirmCopy'
import { NOTES_SAVE_HINT, NOTES_SECTION, WRITE_A_NOTE } from './tuneScreenCopy'

const stored = (text: string): string | null => text.trim() || null

/**
 * A tune's notes, typed straight into the page. Each change saves as it is typed; the edit is
 * reported once per visit to the field, as it is left. While focus is in the field, a line under
 * it says the words are kept, and its Done leaves the field.
 */
export function NotesField({ tuneId, notes }: { tuneId: string; notes: string | null }) {
  const db = useDb()
  const analytics = useAnalytics()
  const { error, run } = useAction()
  // What was typed, kept while the field has focus so a save echoing back never moves the
  // caret; unfocused, the field follows the stored notes once they change.
  const [typed, setTyped] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [seen, setSeen] = useState(notes)
  if (seen !== notes) {
    setSeen(notes)
    if (!focused) setTyped(null)
  }
  const atFocus = useRef<string | null>(null)
  // Writes run in the order typed, so a slow one never lands over a later keystroke.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const report = (text: string | null) => {
    const started = atFocus.current
    atFocus.current = null
    if (text === null || started === null || stored(text) === stored(started)) return
    analytics.send('tune_edited', { fields_changed: ['notes'], tune_id: tuneId })
  }

  const reportRef = useLatest(() => report(typed))
  // Leaving the page with the field focused fires no blur.
  useEffect(() => () => reportRef.current(), [reportRef])

  const change = (text: string) => {
    setTyped(text)
    const next = queue.current.then(async () => {
      const userTune = await db.user_tunes.where('tune_id').equals(tuneId).first()
      if (userTune && !userTune.deleted_at) {
        await updateUserTune(db, userTune.id, { notes: stored(text) })
      }
    })
    queue.current = next.catch(() => {})
    run(() => next)
  }

  // Focus anywhere in the notes, Done included, so a keyboard reaching Done keeps the line.
  const [editing, setEditing] = useState(false)

  return (
    <div
      onFocus={() => setEditing(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false)
      }}
    >
      <div className="bg-surface rounded-(--radius-surface)">
        <TextField
          label={NOTES_SECTION}
          standalone
          multiline
          grow
          placeholder={WRITE_A_NOTE}
          maxLength={TUNE_LIMITS.notes}
          value={typed ?? notes ?? ''}
          onChange={change}
          onFocusChange={(next) => {
            setFocused(next)
            if (next) {
              // What the field shows, which leads the stored notes while a save is landing.
              atFocus.current = typed ?? notes ?? ''
              return
            }
            report(typed)
            // Saves still landing hand the field back once the stored notes change.
            if (typed === null || stored(typed) === notes) setTyped(null)
          }}
        />
      </div>
      {editing && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="t-caption text-ink-2 font-normal">{NOTES_SAVE_HINT}</p>
          <Button
            label={DONE}
            // Focus stays in the field through a press, so its blur cannot hide Done before the
            // press lands.
            preventFocusOnPress
            onPress={() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            }}
          />
        </div>
      )}
      <ErrorLine error={error} place="inline" />
    </div>
  )
}
