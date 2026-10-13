import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import { DELETING } from '../../../ui/confirmCopy'
import { Group } from '../../../ui/form/Group'
import { TextField } from '../../../ui/form/TextField'
import { Sheet } from '../../../ui/Sheet'
import { MANAGE_APP_STORE } from '../../plan/planCopy'
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

/**
 * The last stop before an account and everything in it, on every device, is gone for good.
 * Every dismissal is refused while the request is in flight: there is no state to return to
 * partway through erasing an account.
 */
export function DeleteAccountSheet({ open, onClosed }: { open: boolean; onClosed: () => void }) {
  const {
    text,
    setText,
    countLines,
    loading,
    subscriptions,
    confirmed,
    run,
    error,
    pending,
    closing,
    close,
  } = useDeleteAccount(open)
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
      cancel={{ onPress: close, isDisabled: pending }}
      primary={{
        label: pending ? DELETING : DELETE_ACCOUNT,
        tone: 'danger',
        onPress: run,
        isDisabled: !confirmed || pending || loading,
      }}
      onClosed={onClosed}
    >
      <div className="flex items-start gap-3 pt-2">
        <div className="bg-danger/12 grid size-10 shrink-0 place-items-center rounded-full">
          <TriangleAlert className="text-danger size-5" aria-hidden />
        </div>
        <div className="min-w-0 pt-0.5">
          <h2 className="t-heading">{DELETE_ACCOUNT_TITLE}</h2>
          <p id={leadId} className="t-body text-ink-2 pt-1">
            {DELETE_ACCOUNT_LEAD}
          </p>
        </div>
      </div>
      {countLines && (
        <ul className="bg-fill t-body marker:text-ink-2 mt-4 flex list-disc flex-col gap-1 rounded-(--radius-surface) py-3 ps-9 pe-4">
          {countLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="t-secondary text-ink-2 flex flex-col gap-2 px-4 pt-3">
        {!loading && <p>{UNSYNCED_LINE}</p>}
        {subscriptions.map(({ line, link }) => (
          <p key={line}>
            {line}
            {link && (
              <>
                {' '}
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-action inline-flex items-center gap-0.5"
                >
                  {MANAGE_APP_STORE}
                  <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                </a>
              </>
            )}
          </p>
        ))}
        <p>
          <strong className="text-ink font-semibold">{CANNOT_UNDO}</strong>
          {NO_RECOVERY}
        </p>
      </div>
      <Group error={error ?? undefined}>
        <TextField standalone label={CONFIRM_LABEL} value={text} onChange={setText} />
      </Group>
    </Sheet>
  )
}
