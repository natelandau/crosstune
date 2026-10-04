import { KEEP_OFFLINE_LABEL } from '../recordingCopy'

export const EXPORT_DATA = 'Export data'
export const EXPORT_TITLE = 'Export data'
export const EXPORT_ACTION = 'Export'
export const exportMissingNote = (onDevice: number, total: number) =>
  `${onDevice} of ${total} ${total === 1 ? 'recording is' : 'recordings are'} on this device. Only those are exported. To include every recording, turn on ${KEEP_OFFLINE_LABEL} and wait for the downloads to finish.`
export const EXPORT_COMPLETE_NOTE =
  'Exports your tunes and lists as spreadsheets, with every recording and notation page, in one zip file.'
export const exportProgress = (done: number, total: number) => `Preparing file ${done} of ${total}`
