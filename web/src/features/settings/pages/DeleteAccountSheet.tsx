import { TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import {
  CANNOT_UNDO,
  CONFIRM_LABEL,
  DELETE_ACCOUNT,
  DELETE_ACCOUNT_LEAD,
  DELETE_ACCOUNT_TITLE,
  NO_RECOVERY,
  UNSYNCED_LINE,
} from '../deleteAccountCopy'
import { useDeleteAccount } from '../useDeleteAccount'
import { CANCEL, DELETING } from '../../../ui/confirmCopy'
import { Button } from '../../../ui/Button'
import { Group } from '../../../ui/form/Group'
import { TextField } from '../../../ui/form/TextField'
import { Sheet } from '../../../ui/Sheet'

/**
 * The last stop before an account and everything in it, on every device, is gone for good.
 * Every dismissal is refused while the request is in flight: there is no state to return to
 * partway through erasing an account.
 */
export function DeleteAccountSheet({ open, onClosed }: { open: boolean; onClosed: () => void }) {
  const { text, setText, countLines, loading, confirmed, run, error, pending, closing, close } =
    useDeleteAccount(open)
  const leadId = useId()
  return (
    <Sheet
      isOpen={open && !closing}
      onOpenChange={(next) => {
        if (!next && !pending) close()
      }}
      title={DELETE_ACCOUNT}
      // The warning, the count list, and the field run longer than a part-height sheet.
      height="full"
      locked={text !== '' || pending}
      describedBy={leadId}
      leading={{ label: CANCEL, onPress: close, isDisabled: pending }}
      onClosed={onClosed}
    >
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <TriangleAlert className="text-danger size-8" aria-hidden />
        <h2 className="t-heading">{DELETE_ACCOUNT_TITLE}</h2>
        <p id={leadId} className="t-body">
          {DELETE_ACCOUNT_LEAD}
        </p>
      </div>
      {countLines && (
        <ul className="t-body list-disc ps-9 pt-2">
          {countLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {!loading && <p className="t-body pt-2">{UNSYNCED_LINE}</p>}
      <p className="t-body pt-2">
        <strong>{CANNOT_UNDO}</strong>
        {NO_RECOVERY}
      </p>
      <Group error={error ?? undefined}>
        <TextField standalone label={CONFIRM_LABEL} value={text} onChange={setText} />
      </Group>
      <div className="pt-4">
        <Button
          variant="destructive"
          fullWidth
          label={pending ? DELETING : DELETE_ACCOUNT}
          isDisabled={!confirmed || pending || loading}
          onPress={run}
        />
      </div>
    </Sheet>
  )
}
