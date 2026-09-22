import { IonButton } from '@ionic/react'
import { useRef } from 'react'
import { addUploadedFile } from '../../commands/recordings'
import { messageFor, useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { InlineError } from '../../ui/InlineError'
import { formatBytes } from '../recording/format'

export const NOT_AUDIO_ERROR = 'Choose an audio file.'
export const EMPTY_FILE_ERROR = 'This file is empty.'
export const UPLOAD_AUDIO = 'Upload audio file'

/** Adds an audio file already on the device as a recording. */
export function UploadButton({
  songId,
  label = 'Upload',
  onError,
}: {
  songId: string | null
  label?: string
  /**
   * Takes the refusal, and null as a fresh pick clears the last one, for a caller with room to
   * show it. A toolbar clips its own contents, so the control there has none of its own.
   */
  onError?: (message: string | null) => void
}) {
  const db = useDb()
  const { error, run } = useAction()
  const picker = useRef<HTMLInputElement>(null)

  const add = async (file: File) => {
    // The server refuses all three of these permanently; storing them would only leave a row
    // stuck waiting on an upload that can never succeed.
    if (!file.type.startsWith('audio/')) throw new Error(NOT_AUDIO_ERROR)
    if (file.size === 0) throw new Error(EMPTY_FILE_ERROR)
    // Read at the moment of the check, so a file picked right after the screen opens is held
    // to the cached limit rather than slipping past an unread one.
    const figures = await getStorage(db)
    if (figures && file.size > figures.max_file_bytes) {
      throw new Error(`Files are limited to ${formatBytes(figures.max_file_bytes)}.`)
    }
    await addUploadedFile(db, file, { songId, label: file.name.replace(/\.[^.]+$/, '') })
  }

  return (
    <div>
      <IonButton className="min-h-11" onClick={() => picker.current?.click()}>
        {label}
      </IonButton>
      {/* The native picker button cannot be relabeled or sized, so it hides behind the button
          above and stays out of the tab order, with its own name for anyone reading the tree. */}
      <input
        ref={picker}
        type="file"
        accept="audio/*"
        aria-label={UPLOAD_AUDIO}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (onError) {
            onError(null)
            add(file).catch((caught: unknown) => onError(messageFor(caught)))
            return
          }
          run(() => add(file))
        }}
      />
      {onError ? null : error ? (
        <InlineError className="px-(--form-inset) pt-1.5">{error}</InlineError>
      ) : null}
    </div>
  )
}
