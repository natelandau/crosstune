import { useAuth } from '@clerk/react'
import { IonButton, IonInput, IonItem } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import {
  confirmMatches,
  countAccountData,
  deleteAccountAndForget,
  deleteOutcomeUnknown,
} from './deleteAccount'
import {
  CANNOT_UNDO,
  CONFIRM_LABEL,
  DELETE_ACCOUNT,
  DELETE_ACCOUNT_LEAD,
  DELETE_ACCOUNT_TITLE,
  DELETE_FAILED,
  DELETE_UNCONFIRMED,
  DELETING,
  NO_RECOVERY,
  SETTINGS_LINE,
  UNSYNCED_LINE,
} from './deleteAccountCopy'

/** One count line, or none for a zero count. */
function countLine(count: number, singular: string, plural: string): string | null {
  if (count <= 0) return null
  return `${count} ${count === 1 ? singular : plural}`
}

function countLines(counts: { tunes: number; lists: number; recordings: number }): string[] {
  return [
    countLine(counts.tunes, 'tune', 'tunes'),
    countLine(counts.lists, 'list', 'lists'),
    countLine(counts.recordings, 'recording and its audio', 'recordings and their audio'),
  ].filter((line): line is string => line !== null)
}

/**
 * The last stop before an account and everything in it, on every device, is gone for good.
 * Every dismissal is refused while the request is in flight: there is no state to return to
 * partway through erasing an account.
 */
export function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const { userId } = useAuthSession()
  const { signOut } = useAuth()
  const engine = useSyncEngine()
  const { error, pending, runThen, clear } = useAction()
  const [text, setText] = useState('')
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState(open)
  // Undefined while loading; null when the local count could not be read, which must not
  // block a musician from deleting an account whose copy on this device is broken.
  const counts = useLiveQuery(
    () => (open ? countAccountData(db).catch(() => null) : undefined),
    [db, open],
  )
  const loading = counts === undefined

  // Reset during render, not after a failure, so a retry keeps what was typed.
  if (open !== openedFor) {
    setOpenedFor(open)
    if (open) {
      setText('')
      setClosing(false)
      clear()
    }
  }

  const confirmed = confirmMatches(text)

  const runDelete = () => {
    if (!confirmed || pending || loading) return
    runThen(
      () =>
        deleteAccountAndForget({ db, userId, engine, signOut: () => signOut() }).catch(
          (cause: unknown) => {
            throw new Error(deleteOutcomeUnknown(cause) ? DELETE_UNCONFIRMED : DELETE_FAILED, {
              cause,
            })
          },
        ),
      () => setClosing(true),
    )
  }

  return (
    <Sheet
      open={open && !closing}
      title={DELETE_ACCOUNT}
      // This form's warning text, count list, and confirm field run longer than a partial
      // sheet's height on touch, where content cannot scroll until the sheet is dragged open;
      // full height opens with everything already reachable.
      height="full"
      dismissible={!pending}
      // Reached only once the close animation has finished, whether Cancel or a gesture began it.
      onClose={onClose}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
    >
      <div className="flex flex-col items-center gap-3 px-(--form-inset) pt-(--form-gutter) text-center">
        <TriangleAlert className="size-8 text-(--ion-color-danger)" aria-hidden />
        <h2 className="type-headline m-0">{DELETE_ACCOUNT_TITLE}</h2>
        <p className="type-body m-0">{DELETE_ACCOUNT_LEAD}</p>
      </div>
      {/* The list is omitted unless the counts are known, so it never understates what is
          about to be lost. */}
      {counts ? (
        <ul className="type-body list-disc px-(--form-inset) pt-(--form-text-gap) pl-9">
          {countLines(counts).map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>{SETTINGS_LINE}</li>
        </ul>
      ) : null}
      {loading ? null : (
        <p className="type-body px-(--form-inset) pt-(--form-text-gap)">{UNSYNCED_LINE}</p>
      )}
      <p className="type-body px-(--form-inset) pt-(--form-text-gap)">
        <strong>{CANNOT_UNDO}</strong>
        {NO_RECOVERY}
      </p>
      <div className="pt-(--form-section-gap)">
        <Group error={error}>
          <IonItem>
            <IonInput
              aria-label={CONFIRM_LABEL}
              placeholder={CONFIRM_LABEL}
              autocapitalize="off"
              autocorrect={false}
              spellcheck={false}
              value={text}
              disabled={pending}
              onIonInput={(event) => {
                setText(String(event.detail.value ?? ''))
                clear()
              }}
            />
          </IonItem>
        </Group>
      </div>
      <div className="px-(--form-inset) pt-(--form-text-gap)">
        <IonButton
          type="button"
          color="danger"
          expand="block"
          disabled={!confirmed || pending || loading}
          onClick={runDelete}
        >
          {pending ? DELETING : DELETE_ACCOUNT}
        </IonButton>
      </div>
    </Sheet>
  )
}
