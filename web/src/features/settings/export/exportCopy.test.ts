import { expect, test } from 'vitest'
import { KEEP_OFFLINE_LABEL } from '../recordingCopy'
import { exportMissingNote, exportProgress } from './exportCopy'

const rest = `Only those are exported. To include every recording, turn on ${KEEP_OFFLINE_LABEL} and wait for the downloads to finish.`

test('the missing note agrees with a total of one', () => {
  expect(exportMissingNote(0, 1)).toBe(`0 of 1 recording is on this device. ${rest}`)
})

test('the missing note agrees with any other total', () => {
  expect(exportMissingNote(12, 30)).toBe(`12 of 30 recordings are on this device. ${rest}`)
})

test('progress reads correctly for any total', () => {
  expect(exportProgress(1, 1)).toBe('Preparing recording 1 of 1')
  expect(exportProgress(4, 12)).toBe('Preparing recording 4 of 12')
})
