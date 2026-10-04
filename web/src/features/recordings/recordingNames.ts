import { CLOSE_PLAYER } from '../player/transportCopy'

/**
 * The verbs and names a recording's controls carry wherever they show: its play control, and
 * the tune line and Go to tune action that open its tune.
 */

export const PLAY = 'Play'
export const DOWNLOAD = 'Download'
export const GO_TO_TUNE = 'Go to tune'

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

export function openTuneName(title: string): string {
  return `Open ${title}`
}
