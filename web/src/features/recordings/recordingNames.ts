import { CLOSE_PLAYER } from '../player/transportCopy'

/** The verbs and names a recording's play control carries, wherever it shows. */

export const PLAY = 'Play'
export const DOWNLOAD = 'Download'

export function playName(title: string): string {
  return `${PLAY} ${title}`
}

export function downloadName(title: string): string {
  return `${DOWNLOAD} ${title}`
}

export function downloadingName(title: string): string {
  return `Downloading ${title}`
}

export function closeRecordingName(title: string): string {
  return `${CLOSE_PLAYER} ${title}`
}
