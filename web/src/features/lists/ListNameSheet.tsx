import { IonButton, IonInput, IonItem } from '@ionic/react'
import { useRef, useState } from 'react'
import { LIST_LIMITS } from '../../api/vocabulary'
import { createList, renameList } from '../../commands/lists'
import { LIST_NAME_REQUIRED } from '../../commands/messages'
import { useDb } from '../../db/DbProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { CANCEL } from '../../ui/Confirm'
import { useSheetSession } from '../../ui/useSheetSession'

export const LIST_NAME_PLACEHOLDER = 'Tuesday jam, square dance set, …'
export const LIST_NAME_LABEL = 'List name'
export const NEW_LIST_TITLE = 'New list'
export const RENAME_LIST_TITLE = 'Rename list'

export type ListNameTarget = { kind: 'new' } | { kind: 'rename'; listId: string; name: string }

/** Names a new list or renames one, over whatever screen asked. */
export function ListNameSheet({
  target,
  onClose,
  onSaved,
}: {
  /** Null means closed; the parent nulls it from onClose. */
  target: ListNameTarget | null
  onClose: () => void
  /** After a successful save, with the list's id. */
  onSaved: (listId: string) => void
}) {
  const db = useDb()
  const { error, pending, runThen, clear } = useAction()
  const [name, setName] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  // The last target stays shown while the sheet animates closed, so its title does not flip.
  const [shown, setShown] = useState<ListNameTarget | null>(null)
  const inputRef = useRef<HTMLIonInputElement>(null)
  const sheet = useSheetSession(target, {
    onOpen: (opened) => {
      setShown(opened)
      setName(opened.kind === 'rename' ? opened.name : '')
      setValidation(null)
      clear()
    },
    onClose,
  })

  const save = () => {
    if (!target || !sheet.canSave()) return
    const trimmed = name.trim()
    if (!trimmed) {
      clear()
      setValidation(LIST_NAME_REQUIRED)
      void inputRef.current?.setFocus()
      return
    }
    setValidation(null)
    sheet.beginSave()
    const current = target
    let listId = current.kind === 'rename' ? current.listId : ''
    runThen(
      async () => {
        try {
          if (current.kind === 'new') listId = await createList(db, trimmed)
          else await renameList(db, current.listId, trimmed)
        } catch (caught) {
          sheet.saveFailed(caught)
        }
      },
      () => {
        sheet.close()
        onSaved(listId)
      },
    )
  }

  const renaming = shown?.kind === 'rename'
  return (
    <Sheet
      open={sheet.open}
      title={renaming ? RENAME_LIST_TITLE : NEW_LIST_TITLE}
      dismissible={false}
      onClose={sheet.dismissed}
      start={
        <IonButton disabled={pending} onClick={sheet.close}>
          {CANCEL}
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || sheet.closing} onClick={save}>
          {renaming ? 'Save' : 'Create'}
        </IonButton>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
        {/* The sheet's title already names the one field, so a header would repeat it. */}
        <Group error={validation ?? error}>
          <IonItem>
            <IonInput
              ref={inputRef}
              aria-label={LIST_NAME_LABEL}
              placeholder={LIST_NAME_PLACEHOLDER}
              maxlength={LIST_LIMITS.name}
              value={name}
              enterkeyhint="done"
              onIonInput={(event) => {
                setName(String(event.detail.value ?? ''))
                setValidation(null)
                clear()
              }}
            />
          </IonItem>
        </Group>
      </form>
    </Sheet>
  )
}
