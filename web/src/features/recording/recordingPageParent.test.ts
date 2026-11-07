import { describe, expect, it } from 'vitest'
import { recordingPageParent, tunePageFor } from './recordingPageParent'

describe('recordingPageParent', () => {
  it.each([
    ['/catalog/t1', 't1', '/catalog/t1'],
    ['/catalog/t1/recordings/r9', 't1', '/catalog/t1'],
    ['/catalog/t2', 't1', '/catalog/t1'],
    ['/catalog', 't1', '/catalog/t1'],
    ['/lists/l1/tunes/t1', 't1', '/lists/l1/tunes/t1'],
    ['/lists/l1/tunes/t2', 't1', '/lists/l1/tunes/t1'],
    ['/lists/l1', 't1', '/lists/l1/tunes/t1'],
    ['/lists', 't1', '/recordings'],
    ['/settings/stats/tunes/t1/recordings/r9', 't1', '/settings/stats/tunes/t1'],
    ['/recordings/t1', 't1', '/recordings'],
    ['/tuner', 't1', '/recordings'],
    ['/catalog/t1', null, '/recordings'],
  ])('from %s for tune %s opens under %s', (pathname, tuneId, parent) => {
    expect(recordingPageParent(pathname, tuneId)).toBe(parent)
  })
})

describe('tunePageFor', () => {
  it.each([
    ['/catalog/t1/recordings/r9', 't1', '/catalog/t1'],
    ['/lists/l1/tunes/t1', 't1', '/lists/l1/tunes/t1'],
    ['/lists/l1/tunes/t2', 't1', '/catalog/t1'],
    ['/settings/stats/tunes/t1', 't1', '/settings/stats/tunes/t1'],
    ['/recordings/t1', 't1', '/recordings/t1'],
    ['/recordings/t2', 't1', '/catalog/t1'],
    ['/recordings/recording/r9', 't1', '/catalog/t1'],
    ['/tuner', 't1', '/catalog/t1'],
  ])('from %s for tune %s opens %s', (pathname, tuneId, path) => {
    expect(tunePageFor(pathname, tuneId)).toBe(path)
  })
})
