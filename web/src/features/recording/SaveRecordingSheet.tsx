import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { updateRecording } from '../../commands/recordings'
import { Sheet } from '../../components/Sheet'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { AttachSongPicker } from './AttachSongPicker'

/** Name a finished take and file it under a song. Every way out leaves the take saved. */
export function SaveRecordingSheet({
  open,
  recordingId,
  songId,
  songTitle,
  warning,
  onDone,
}: {
  open: boolean
  recordingId: string
  songId: string | null
  songTitle: string | null
  warning: string | null
  /** Called with the song the take ended up attached to, or null when it has none. */
  onDone: (songId: string | null) => void
}) {
  const db = useDb()
  const navigate = useNavigate()
  const [label, setLabel] = useState('')
  const [attachTo, setAttachTo] = useState<{ id: string; title: string } | null>(null)
  const { error, pending, runThen } = useAction()
  const target = songId ?? attachTo?.id ?? null
  const trimmed = () => label.trim() || null

  return (
    <Sheet open={open} title="Save recording" onClose={() => onDone(songId)} dismissible={false}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          runThen(
            () => updateRecording(db, recordingId, { label: trimmed(), song_id: target }),
            () => onDone(target),
          )
        }}
      >
        {warning ? (
          <p role="alert" className="text-error text-sm">
            {warning}
          </p>
        ) : null}
        <label className="input min-h-11 w-full">
          <span className="label">Recording name</span>
          <input
            className="grow"
            aria-label="Recording name"
            value={label}
            maxLength={200}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        {songId ? (
          <p className="text-sm">Attached to {songTitle}</p>
        ) : attachTo ? (
          <p className="flex items-center gap-2 text-sm">
            Attached to {attachTo.title}
            <button
              type="button"
              className="btn btn-ghost btn-sm min-h-11"
              onClick={() => setAttachTo(null)}
            >
              Change
            </button>
          </p>
        ) : (
          <>
            <AttachSongPicker onPick={(id, title) => setAttachTo({ id, title })} />
            <button
              type="button"
              className="btn btn-outline min-h-11 w-full"
              disabled={pending}
              onClick={() =>
                runThen(
                  () => updateRecording(db, recordingId, { label: trimmed() }),
                  // Replacing keeps Back from landing on /record, which would start a new take.
                  () =>
                    void navigate({
                      to: '/songs/new',
                      search: { attach: recordingId },
                      replace: true,
                    }),
                )
              }
            >
              New song
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className="text-error text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn min-h-11 flex-1" onClick={() => onDone(songId)}>
            Skip
          </button>
          <button type="submit" className="btn btn-primary min-h-11 flex-1" disabled={pending}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  )
}
