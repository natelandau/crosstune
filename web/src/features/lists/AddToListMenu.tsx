import { ErrorText, HelpText, Section } from '../../components/Page'
import { addToList, removeFromList } from '../../commands/lists'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { useLists, useMembership } from './useLists'

export function AddToListMenu({ userSongId }: { userSongId: string }) {
  const db = useDb()
  const lists = useLists() ?? []
  const membership = useMembership(userSongId)
  const { error, run } = useAction()

  async function toggle(listId: string, checked: boolean) {
    if (checked) {
      await addToList(db, listId, userSongId)
      return
    }
    const items = await db.list_items.where('user_song_id').equals(userSongId).toArray()
    const item = items.find((i) => i.list_id === listId && !i.deleted_at)
    if (item) await removeFromList(db, item.id)
  }

  return (
    <Section title="Lists">
      {lists.length === 0 ? (
        <HelpText>No lists yet. Create one from the Lists tab.</HelpText>
      ) : (
        <ul className="space-y-1">
          {lists.map((list) => (
            <li key={list.id}>
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={membership.has(list.id)}
                  onChange={(e) => run(() => toggle(list.id, e.target.checked))}
                />
                {list.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Section>
  )
}
