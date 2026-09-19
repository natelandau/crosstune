import { IonButton, IonInput, IonItem } from '@ionic/react'
import { useRef, useState } from 'react'
import { createList, renameList } from '../../commands/lists'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { LIST_NAME_MAX_LENGTH } from './limits'

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
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState<ListNameTarget | null>(null)
  // The last target stays shown while the sheet animates closed, so its title does not flip.
  const [shown, setShown] = useState<ListNameTarget | null>(null)
  const saving = useRef<ListNameTarget | null>(null)
  const inputRef = useRef<HTMLIonInputElement>(null)

  if (target !== openedFor) {
    setOpenedFor(target)
    if (target) {
      setShown(target)
      setName(target.kind === 'rename' ? target.name : '')
      setValidation(null)
      setClosing(false)
      clear()
    }
  }

  // A dismissal that ends after a new target opened belongs to the old one, so it closes nothing.
  const dismissed = () => {
    saving.current = null
    if (target === null || closing) onClose()
  }

  const save = () => {
    if (!target || closing || saving.current === target) return
    const trimmed = name.trim()
    if (!trimmed) {
      clear()
      setValidation('A list needs a name')
      void inputRef.current?.setFocus()
      return
    }
    setValidation(null)
    saving.current = target
    const current = target
    let listId = current.kind === 'rename' ? current.listId : ''
    runThen(
      async () => {
        try {
          if (current.kind === 'new') listId = await createList(db, trimmed)
          else await renameList(db, current.listId, trimmed)
        } catch (caught) {
          saving.current = null
          throw caught
        }
      },
      () => {
        setClosing(true)
        onSaved(listId)
      },
    )
  }

  const renaming = shown?.kind === 'rename'
  return (
    <Sheet
      open={target !== null && !closing}
      title={renaming ? 'Rename list' : 'New list'}
      dismissible={false}
      onClose={dismissed}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || closing} onClick={save}>
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
        <Group header="Name" error={validation ?? error}>
          <IonItem>
            <IonInput
              ref={inputRef}
              aria-label="List name"
              placeholder="Tuesday jam, square dance set, …"
              maxlength={LIST_NAME_MAX_LENGTH}
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
