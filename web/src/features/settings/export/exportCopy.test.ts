import { expect, test } from 'vitest'
import { exportNeedsConnection, exportNeedsSpace, exportProgress } from './exportCopy'

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

test.each([
  [2_100_000_000, 'about 2.1 GB'],
  [2_000_000_001, 'about 2.1 GB'],
  [1_000_000_000, 'about 1 GB'],
  [350_400_000, 'about 350.4 MB'],
])('the out-of-room note asks for %i bytes as %s', (bytes, amount) => {
  expect(exportNeedsSpace(bytes)).toBe(
    `Not enough free space on this device to export. Free up ${amount} and try again.`,
  )
})

test('the out-of-room note without a known shortfall asks for some space', () => {
  expect(exportNeedsSpace(null)).toBe(
    'Not enough free space on this device to export. Free up some space and try again.',
  )
})
