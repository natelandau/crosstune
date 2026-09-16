import { SONG_LIMITS } from './limits'

export interface NewSongSearch {
  title?: string
  /** A recording to attach to the song once it is created. */
  attach?: string
  /** A list to add the song to once it is created. */
  list?: string
}

export function parseNewSongSearch(search: Record<string, unknown>): NewSongSearch {
  const title = typeof search.title === 'string' ? search.title.trim() : ''
  const attach = typeof search.attach === 'string' ? search.attach : ''
  const list = typeof search.list === 'string' ? search.list : ''
  return {
    ...(title ? { title: title.slice(0, SONG_LIMITS.title) } : {}),
    ...(attach ? { attach } : {}),
    ...(list ? { list } : {}),
  }
}
