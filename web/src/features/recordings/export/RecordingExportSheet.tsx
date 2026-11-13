import { CONTINUE } from '../../../ui/confirmCopy'
import { ErrorLine } from '../../../ui/ErrorLine'
import { Sheet } from '../../../ui/Sheet'
import { DOWNLOAD } from '../recordingNames'
import { TRY_AGAIN } from './exportCopy'

export interface RecordingExportSheetProps {
  open: boolean
  /** Why some recordings stay out; with it the sheet asks to continue before it starts. */
  skipped: string | null
  progress: string | null
  error: string | null
  pending: boolean
  /** False when no recording in the download can be exported. */
  canContinue: boolean
  /** Starts the export: Continue past what it skips, and Try again after a failure. */
  onStart: () => void
  /** Abandons any export in progress and closes. */
  onCancel: () => void
}

/** Try again after a failure, else Continue past what the download skips, else none. */
function primaryButton({
  skipped,
  error,
  pending,
  canContinue,
  onStart,
}: Pick<RecordingExportSheetProps, 'skipped' | 'error' | 'pending' | 'canContinue' | 'onStart'>) {
  if (error !== null && !pending) return { label: TRY_AGAIN, onPress: onStart }
  if (skipped === null) return undefined
  return { label: CONTINUE, onPress: onStart, isDisabled: pending || !canContinue }
}

/**
 * A download of one or more recordings: what it leaves out, then its progress, then any failure
 * with Try again, with Cancel throughout.
 */
export function RecordingExportSheet({
  open,
  skipped,
  progress,
  error,
  pending,
  canContinue,
  onStart,
  onCancel,
}: RecordingExportSheetProps) {
  return (
    <Sheet
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={DOWNLOAD}
      // Cancel is the way out mid-export, so a late dismiss cannot let a finished export
      // download.
      locked={pending}
      cancel={{ onPress: onCancel }}
      primary={primaryButton({ skipped, error, pending, canContinue, onStart })}
    >
      {skipped !== null && <p className="t-body pt-2">{skipped}</p>}
      {progress && (
        <p role="status" className="t-body pt-2">
          {progress}
        </p>
      )}
      <ErrorLine error={error} place="inline" />
    </Sheet>
  )
}
