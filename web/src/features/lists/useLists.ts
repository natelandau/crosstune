import { useLiveQuery } from 'dexie-react-hooks'
import { activeItems } from '../../commands/lists'
import { activeByPosition } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import type { LocalList, LocalListItem, LocalSong, LocalUserSong } from '../../db/types'

export type ListSummary = LocalList & { count: number }

export function useLists(): ListSummary[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const lists = activeByPosition(await db.lists.toArray())
    const items = (await db.list_items.toArray()).filter((i) => !i.deleted_at)
    return lists.map((list) => ({
      ...list,
      count: items.filter((i) => i.list_id === list.id).length,
    }))
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
      if (userSong && !userSong.deleted_at && song && !song.deleted_at) {
        views.push({ item, song, userSong })
      }
    }
    return { list, items: views }
  }, [db, listId])
}

export function useMembership(userSongId: string): Set<string> {
  const db = useDb()
  return (
    useLiveQuery(async () => {
      const items = await db.list_items.where('user_song_id').equals(userSongId).toArray()
      return new Set(items.filter((i) => !i.deleted_at).map((i) => i.list_id))
    }, [db, userSongId]) ?? new Set<string>()
  )
}
