import { EXPORT_ACTION, EXPORT_TITLE } from '../export/exportCopy'
import { useExportData } from '../export/useExportData'
import { CANCEL } from '../../../ui/confirmCopy'
import { ErrorLine } from '../../../ui/ErrorLine'
import { Sheet } from '../../../ui/Sheet'

/** The export, in a sheet. Closing the sheet by any route abandons an export in progress. */
export function ExportSheet({ open, onClosed }: { open: boolean; onClosed: () => void }) {
  const { counts, progress, note, run, abandon, error, pending, closing, close } =
    useExportData(open)
  return (
    <Sheet
      isOpen={open && !closing}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title={EXPORT_TITLE}
      // Cancel is the way out mid-export, so a late dismiss cannot let a finished export
      // download.
      locked={pending}
      leading={{ label: CANCEL, onPress: close }}
      primary={{ label: EXPORT_ACTION, onPress: run, isDisabled: pending || !counts }}
      onClosed={() => {
        abandon()
        onClosed()
      }}
    >
      {note && <p className="t-body pt-2">{note}</p>}
      {progress && (
        <p role="status" className="t-body pt-2">
          {progress.label}
        </p>
      )}
      <ErrorLine error={error} place="inline" />
    </Sheet>
  )
}
