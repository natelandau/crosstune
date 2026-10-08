import { useMemo, useRef, useState, type ReactNode } from 'react'
import { LIST_LIMITS } from '../../api/vocabulary'
import {
  CREATE_LIST,
  LIST_NAME_LABEL,
  LIST_NAME_PLACEHOLDER,
  NEW_LIST_TITLE,
  RENAME_LIST_TITLE,
  SAVE_LIST_NAME,
} from './listsCopy'
import { useListName, type ListNameTarget } from './useListName'
import { Group } from '../../ui/form/Group'
import { TextField } from '../../ui/form/TextField'
import { Sheet } from '../../ui/Sheet'
import { useEndOnClose } from '../../ui/useEndOnClose'
import { ListNameLauncherContext, type ListNameLauncher } from './listNameLauncher'

/** Names a new list or renames one, over whatever screen asked. */
export function ListNameSheet({
  target,
  onClose,
}: {
  /** Null while closed; the caller nulls it from `onClose`. */
  target: ListNameTarget | null
  onClose: () => void
}) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const form = useListName(target, {
    onSaved: () => {},
    onClose,
    onInvalid: () => fieldRef.current?.focus(),
  })

  useEndOnClose(form.closing, form.dismissed)

  const initial = target?.kind === 'rename' ? target.name : ''
  const dirty = target !== null && form.name !== initial
  return (
    <Sheet
      isOpen={form.open}
      onOpenChange={(open) => {
        if (!open) form.close()
      }}
      title={form.renaming ? RENAME_LIST_TITLE : NEW_LIST_TITLE}
      height="part"
      locked={dirty || form.pending}
      primary={{
        label: form.renaming ? SAVE_LIST_NAME : CREATE_LIST,
        onPress: form.save,
        isDisabled: form.pending || form.closing,
      }}
    >
      <form
        noValidate
        className="pb-4"
        onSubmit={(event) => {
          event.preventDefault()
          form.save()
        }}
      >
        {/* The sheet's title already names the one field, so a header would repeat it. */}
        <Group error={form.invalid ?? form.error ?? undefined}>
          <TextField
            ref={fieldRef}
            standalone
            label={LIST_NAME_LABEL}
            placeholder={LIST_NAME_PLACEHOLDER}
            value={form.name}
            maxLength={LIST_LIMITS.name}
            enterKeyHint="done"
            isInvalid={form.invalid !== null}
            autoFocus
            onChange={form.setName}
          />
        </Group>
      </form>
    </Sheet>
  )
}

/** Opens the list name sheet for a new list from anywhere: the sidebar, Lists, or Quick Find. */
export function ListNameLauncherProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ListNameTarget | null>(null)
  const launcher = useMemo<ListNameLauncher>(() => ({ open: () => setTarget({ kind: 'new' }) }), [])
  return (
    <ListNameLauncherContext.Provider value={launcher}>
      {children}
      <ListNameSheet target={target} onClose={() => setTarget(null)} />
    </ListNameLauncherContext.Provider>
  )
}
