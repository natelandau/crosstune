import type { Provider } from '../api/vocabulary'
import type { CrosstuneDb } from '../db/schema'
import { newId, nextPosition, now, putRow, tombstone, writeTx } from './write'

export interface LinkInput {
  url: string
  provider: Provider
  provider_ref?: string | null
  title?: string | null
  artwork_url?: string | null
  label?: string | null
}

export async function addLink(db: CrosstuneDb, songId: string, link: LinkInput): Promise<string> {
  const at = now()
  const id = newId()
  await writeTx(db, async () => {
    const song = await db.songs.get(songId)
    if (!song || song.deleted_at) throw new Error('Song not found')
    const existing = await db.recording_links.where('song_id').equals(songId).toArray()
    const active = existing.filter((l) => !l.deleted_at)
    await putRow(db, 'recording_links', {
      id,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      song_id: songId,
      url: link.url.trim(),
      provider: link.provider,
      provider_ref: link.provider_ref ?? null,
      title: link.title ?? null,
      artwork_url: link.artwork_url ?? null,
      label: link.label ?? null,
      position: nextPosition(active),
    })
  })
  return id
}

export async function removeLink(db: CrosstuneDb, linkId: string): Promise<void> {
  await writeTx(db, () => tombstone(db, 'recording_links', linkId, now()))
}
