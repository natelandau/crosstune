import type { LocalSong } from './types'

/** A song present and not tombstoned, or null: the shape every caller that resolves a
 * song reference (a recording's, a take's, a user song's) actually needs. */
export function liveSong(song: LocalSong | null | undefined): LocalSong | null {
  return song && !song.deleted_at ? song : null
}
