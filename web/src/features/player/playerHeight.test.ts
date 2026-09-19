import { describe, expect, it } from 'vitest'
import { AUDIO_HEIGHT_PX, CHROME_HEIGHT_PX, VIDEO_HEIGHT_PX, dockHeight } from './playerHeight'

describe('dockHeight', () => {
  it('gives a recording room for its audio element', () => {
    expect(dockHeight({ kind: 'recording' })).toBe(CHROME_HEIGHT_PX + AUDIO_HEIGHT_PX)
  })

  it("gives a link its embed's own height", () => {
    expect(dockHeight({ kind: 'link', height: 152 })).toBe(CHROME_HEIGHT_PX + 152)
  })

  it('gives a video embed the height of a video player', () => {
    expect(dockHeight({ kind: 'link', height: 'video' })).toBe(CHROME_HEIGHT_PX + VIDEO_HEIGHT_PX)
  })
})
