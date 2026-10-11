import { expect, test } from 'vitest'
import { exportNeedsConnection, exportProgress } from './exportCopy'

test('the connection note agrees with one missing file', () => {
  expect(exportNeedsConnection(1)).toBe(
    'Connect to the internet to export 1 file that is not on this device.',
  )
})

test('the connection note agrees with any other count', () => {
  expect(exportNeedsConnection(12)).toBe(
    'Connect to the internet to export 12 files that are not on this device.',
  )
})

test('progress reads correctly for any total', () => {
  expect(exportProgress(1, 1)).toBe('Preparing file 1 of 1')
  expect(exportProgress(4, 12)).toBe('Preparing file 4 of 12')
})
