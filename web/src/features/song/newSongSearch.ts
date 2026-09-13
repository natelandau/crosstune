import { SONG_LIMITS } from './limits'

export interface NewSongSearch {
  title?: string
}

export function parseNewSongSearch(search: Record<string, unknown>): NewSongSearch {
  const title = typeof search.title === 'string' ? search.title.trim() : ''
  return title ? { title: title.slice(0, SONG_LIMITS.title) } : {}
}
