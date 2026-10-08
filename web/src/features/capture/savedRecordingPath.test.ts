import { describe, expect, it } from 'vitest'
import { savedRecordingPath } from './savedRecordingPath'

describe('savedRecordingPath', () => {
  it("goes to the tune's page from anywhere else", () => {
    expect(savedRecordingPath('t1', '/catalog')).toBe('/catalog/t1')
    expect(savedRecordingPath('t1', '/recordings')).toBe('/catalog/t1')
  })

  it("stays on the tune's page in any destination", () => {
    expect(savedRecordingPath('t1', '/catalog/t1')).toBeNull()
    expect(savedRecordingPath('t1', '/lists/l1/tunes/t1')).toBeNull()
    expect(savedRecordingPath('t1', '/recordings/t1/')).toBeNull()
  })

  it('treats a tune whose id ends another tune id as a different page', () => {
    expect(savedRecordingPath('t1', '/catalog/at1')).toBe('/catalog/t1')
    expect(savedRecordingPath('1', '/catalog/t1')).toBe('/catalog/1')
  })

  it('goes to Recordings with no tune, unless already there', () => {
    expect(savedRecordingPath(null, '/catalog')).toBe('/recordings')
    expect(savedRecordingPath(null, '/recordings/t1')).toBe('/recordings')
    expect(savedRecordingPath(null, '/recordings')).toBeNull()
    expect(savedRecordingPath(null, '/recordings/')).toBeNull()
  })
})
