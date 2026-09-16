import { Plus, X } from 'lucide-react'
import { useId } from 'react'
import { addToList, createList, removeFromList } from '../../commands/lists'
import { ErrorText, HelpText, Section } from '../../components/Page'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import type { CatalogEntry } from '../catalog/filters'
import { useLists, useMembership } from '../lists/useLists'
import { ListPickerSheet } from '../selection/ListPickerSheet'

export function SongLists({
  userSongId,
  entry,
  pickerOpen,
  onPickerOpenChange,
}: {
  userSongId: string
  entry: CatalogEntry
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
}) {
  const db = useDb()
  const lists = useLists() ?? []
  const membership = useMembership(userSongId)
  const { error, run } = useAction()
  const titleId = useId()
  const inLists = lists.filter((list) => membership.has(list.id))
  return (
    <Section title={<span id={titleId}>Lists</span>}>
      <div role="region" aria-labelledby={titleId} className="flex flex-wrap gap-2">
        {inLists.map((list) => (
          <button
            key={list.id}
            type="button"
            className="btn btn-soft btn-sm min-h-11 rounded-full pr-2 pl-3 font-medium"
            aria-label={`Remove from ${list.name}`}
            onClick={() => {
              const itemId = membership.get(list.id)
              if (itemId) run(() => removeFromList(db, itemId))
            }}
          >
            {list.name}
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ))}
        <button
          type="button"
          className="btn btn-sm min-h-11 rounded-full"
          onClick={() => onPickerOpenChange(true)}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add to list
        </button>
      </div>
      {inLists.length === 0 ? <HelpText>Not in any list yet.</HelpText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ListPickerSheet
        open={pickerOpen}
        entries={[entry]}
        onClose={() => onPickerOpenChange(false)}
        onAdd={(list) => {
          onPickerOpenChange(false)
          run(() => addToList(db, list.id, userSongId))
        }}
        onCreate={(name) => {
          onPickerOpenChange(false)
          run(async () => addToList(db, await createList(db, name.trim()), userSongId))
        }}
      />
    </Section>
  )
}
