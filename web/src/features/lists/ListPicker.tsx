import { IonButton, IonInput, IonItem, IonLabel, IonNote } from '@ionic/react'
import { useRef, useState } from 'react'
import { LIST_LIMITS } from '../../api/vocabulary'
import { addSongsToList, createListWithSongs, type Undo } from '../../commands/bulk'
import { useDb } from '../../db/DbProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { countSongs } from '../selection/copy'
import { useLists, useMembershipCounts } from './useLists'

/**
 * What one successful add did. The picker reports the facts rather than a sentence, so the
 * caller words its own toast and holds the undo; the wording differs between the song page
 * and a bulk selection.
 */
export interface ListAddition {
  undo: Undo
  /** How many of the selection were actually added, since a song already in the list does not count again. */
  added: number
  listName: string
  /** True when the pick created the list rather than adding to one that already existed. */
  created: boolean
}

/** Adds one or more songs to an existing list, or to a new one, without leaving the page behind it. */
export function ListPicker({
  open,
  userSongIds,
  excludeListId,
  title,
  onClose,
  onAdded,
}: {
  open: boolean
  userSongIds: readonly string[]
  /** Left off the offered lists, such as the list already open on the list detail screen. */
  excludeListId?: string
  /** Defaults to naming the selection size; a caller with its own fixed wording passes this instead. */
  title?: string
  onClose: () => void
  /** What the add did, for a caller that toasts it and offers the undo. */
  onAdded?: (addition: ListAddition) => void
}) {
  const db = useDb()
  const lists = (useLists() ?? []).filter((list) => list.id !== excludeListId)
  const counts = useMembershipCounts(userSongIds)
  const total = userSongIds.length
  const { error, pending, runThen, clear } = useAction()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  // Set by a successful pick or create; the sheet closes itself so a fast second tap during
  // the dismiss animation has nothing left to act on.
  const [closing, setClosing] = useState(false)
  // A click handler reads `pending` before React commits the state from an earlier click in
  // the same tick, so the same-tick guard needs a ref instead.
  const busy = useRef(false)
  const [wasOpen, setWasOpen] = useState(open)

  // Reset during render, not an effect, so the sheet's next open already starts clean instead
  // of flashing the previous session's half-typed name for a frame.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setCreating(false)
      setName('')
      setClosing(false)
      clear()
    }
  }

  // The single place that reports a close, fired once per dismiss regardless of its cause:
  // a pick, Create, Cancel, or a backdrop tap.
  const dismissed = () => {
    busy.current = false
    onClose()
  }

  const add = (list: { id: string; name: string }) => {
    if (busy.current || closing) return
    busy.current = true
    let addition: ListAddition | null = null
    runThen(
      async () => {
        try {
          const { undo, added } = await addSongsToList(db, list.id, userSongIds)
          addition = { undo, added, listName: list.name, created: false }
        } catch (caught) {
          busy.current = false
          throw caught
        }
      },
      () => {
        setClosing(true)
        // A write that lands without reporting itself would close the sheet with no toast and
        // no undo, so it fails here rather than degrading into a silent, unrepeatable add.
        if (!addition) throw new Error('The add reported nothing to undo')
        onAdded?.(addition)
      },
    )
  }

  const create = () => {
    const listName = name.trim()
    if (busy.current || closing || !listName) return
    busy.current = true
    let addition: ListAddition | null = null
    runThen(
      async () => {
        try {
          const undo = await createListWithSongs(db, listName, userSongIds)
          addition = { undo, added: total, listName, created: true }
        } catch (caught) {
          busy.current = false
          throw caught
        }
      },
      () => {
        setClosing(true)
        // A write that lands without reporting itself would close the sheet with no toast and
        // no undo, so it fails here rather than degrading into a silent, unrepeatable add.
        if (!addition) throw new Error('The add reported nothing to undo')
        onAdded?.(addition)
      },
    )
  }

  return (
    <Sheet
      open={open && !closing}
      title={title ?? `Add ${countSongs(total)} to a list`}
      dismissible={!pending}
      onClose={dismissed}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
    >
      <Group error={error}>
        {lists.map((list) => {
          const loaded = counts !== undefined
          const inList = counts?.get(list.id) ?? 0
          const full = loaded && total > 0 && inList >= total
          const note = !loaded
            ? null
            : inList === 0
              ? 'none in it'
              : full
                ? 'all in it'
                : `${inList} of ${total} in it`
          const disabled = full || pending || !loaded
          return (
            <IonItem
              key={list.id}
              button={!disabled}
              disabled={disabled}
              detail={false}
              onClick={disabled ? undefined : () => add(list)}
            >
              <IonLabel className="truncate">{list.name}</IonLabel>
              {note ? (
                <IonNote slot="end" className="tabular-nums">
                  {note}
                </IonNote>
              ) : null}
            </IonItem>
          )
        })}
        {creating ? (
          <IonItem>
            <IonInput
              aria-label="New list name"
              placeholder="Tuesday jam, square dance set, …"
              autofocus
              maxlength={LIST_LIMITS.name}
              value={name}
              onIonInput={(event) => setName(String(event.detail.value ?? ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create()
              }}
            />
            <IonButton slot="end" fill="clear" disabled={!name.trim() || pending} onClick={create}>
              Create
            </IonButton>
          </IonItem>
        ) : (
          <IonItem button detail={false} disabled={pending} onClick={() => setCreating(true)}>
            <IonLabel color="primary">New list…</IonLabel>
          </IonItem>
        )}
      </Group>
    </Sheet>
  )
}
