import { useLiveQuery } from 'dexie-react-hooks'
import { activeItems } from '../../commands/lists'
import { activeByPosition } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import { liveSong } from '../../db/songs'
import type { LocalList, LocalListItem, LocalSong, LocalUserSong } from '../../db/types'

export type ListSummary = LocalList & { count: number; lastEditedAt: string }

/** The newest updated_at across a list and its item rows; removed items count, since removing a song edits the list. */
function lastEdited(list: LocalList, items: LocalListItem[]): string {
  return items.reduce(
    (latest, item) => (Date.parse(item.updated_at) > Date.parse(latest) ? item.updated_at : latest),
    list.updated_at,
  )
}

export function useLists(): ListSummary[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const lists = activeByPosition(await db.lists.toArray())
    const items = await db.list_items.toArray()
    return lists.map((list) => {
      const own = items.filter((i) => i.list_id === list.id)
      return {
        ...list,
        count: own.filter((i) => !i.deleted_at).length,
        lastEditedAt: lastEdited(list, own),
      }
    })
  }, [db])
}

export interface ListItemView {
  item: LocalListItem
  song: LocalSong
  userSong: LocalUserSong
}

export function useListView(
  listId: string,
): { list: LocalList; items: ListItemView[] } | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const list = await db.lists.get(listId)
    if (!list || list.deleted_at) return null
    const items = await activeItems(db, listId)
    const userSongs = await db.user_songs.bulkGet(items.map((item) => item.user_song_id))
    const songs = await db.songs.bulkGet(userSongs.map((userSong) => userSong?.song_id ?? ''))
    const views: ListItemView[] = []
    for (const [index, item] of items.entries()) {
      const userSong = userSongs[index]
      const song = songs[index]
      const liveSongRow = liveSong(song)
      if (userSong && !userSong.deleted_at && liveSongRow) {
        views.push({ item, song: liveSongRow, userSong })
      }
    }
    return { list, items: views }
  }, [db, listId])
}

/** The song's live list item per list it is in, keyed by list id, so removal has the item to tombstone. */
export function useMembership(userSongId: string): Map<string, string> {
  const db = useDb()
  return (
    useLiveQuery(async () => {
      const items = await db.list_items.where('user_song_id').equals(userSongId).toArray()
      return new Map(items.filter((i) => !i.deleted_at).map((i) => [i.list_id, i.id]))
    }, [db, userSongId]) ?? new Map<string, string>()
  )
}
