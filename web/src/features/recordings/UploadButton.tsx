import { IonButton } from '@ionic/react'
import { useRef } from 'react'
import { messageFor, useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { InlineError } from '../../ui/InlineError'
import { addAudioFiles } from './addAudioFiles'

export const UPLOAD_AUDIO = 'Upload audio files'

/** Adds audio files already on the device as recordings. */
export function UploadButton({
  tuneId,
  label = 'Upload',
  onError,
}: {
  tuneId: string | null
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

  const add = (files: File[]) => addAudioFiles(db, files, tuneId)

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
        multiple
        aria-label={UPLOAD_AUDIO}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length === 0) return
          if (onError) {
            onError(null)
            add(files).catch((caught: unknown) => onError(messageFor(caught)))
            return
          }
          run(() => add(files))
        }}
      />
      {onError ? null : error ? (
        <InlineError className="px-(--form-inset) pt-1.5">{error}</InlineError>
      ) : null}
    </div>
  )
}
