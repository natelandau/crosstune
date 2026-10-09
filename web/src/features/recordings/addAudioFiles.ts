import type { AudioFormat } from '../../usage/events'
import { addUploadedFile } from '../../commands/recordings'
import { getStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { messageFor } from '../../ui/useAction'
import { formatBytes } from '../../text/format'
import { measureDuration } from '../capture/measureDuration'

export const NOT_AUDIO_ERROR = 'Choose an audio file.'
export const EMPTY_FILE_ERROR = 'This file is empty.'

/** A refusal from a batch of files, named for the file it refused. */
export const refusedFile = (name: string, message: string) => `${name}: ${message}`

/** Adds an audio file already on the device as a recording, filed under `tuneId` or unfiled. */
export async function addAudioFile(db: CrosstuneDb, file: File, tuneId: string | null) {
  // The server refuses all three of these permanently; storing them would only leave a row
  // stuck waiting on an upload that can never succeed.
  if (!file.type.startsWith('audio/')) throw new Error(NOT_AUDIO_ERROR)
  if (file.size === 0) throw new Error(EMPTY_FILE_ERROR)
  // Read at the moment of the check, so a file picked right after the screen opens is held
  // to the cached limit rather than slipping past an unread one.
  const figures = await getStorage(db)
  if (figures && file.size > figures.max_file_bytes) {
    throw new Error(`Files are limited to ${formatBytes(figures.max_file_bytes)}.`)
  }
  // Measured here, before the upload, so the file can be played and trimmed to its real
  // length while it is still only on this device.
  const durationMs = await measureDuration(file)
  await addUploadedFile(db, file, {
    tuneId,
    label: file.name.replace(/\.[^.]+$/, ''),
    durationMs,
  })
}

const FORMAT_BY_EXTENSION: Record<string, AudioFormat> = {
  m4a: 'm4a',
  mp3: 'mp3',
  wav: 'wav',
  aif: 'aiff',
  aiff: 'aiff',
  flac: 'flac',
}

/** The plan's audio format for a file, from its extension. */
export function audioFormatOf(file: File): AudioFormat {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? ''
  return FORMAT_BY_EXTENSION[extension] ?? 'other'
}

/**
 * Adds each file in turn, so one refusal never costs the rest of the batch. Rejects with the
 * first refusal once every file has had its turn, named for its file when there were several.
 */
export async function addAudioFiles(
  db: CrosstuneDb,
  files: readonly File[],
  tuneId: string | null,
  /** Called with each file once it is stored, so a caller knows what landed before a refusal. */
  onAdded: (file: File) => void = () => {},
) {
  let refusal: string | null = null
  for (const file of files) {
    try {
      await addAudioFile(db, file, tuneId)
      onAdded(file)
    } catch (caught) {
      const message = messageFor(caught)
      refusal ??= files.length > 1 ? refusedFile(file.name, message) : message
    }
  }
  if (refusal !== null) throw new Error(refusal)
}
