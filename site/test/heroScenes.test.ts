import { describe, expect, it } from 'vitest'
import { nextScene, type SceneState } from '../src/scripts/heroScenes'

const playing: SceneState = { index: 0, paused: false }

describe('nextScene', () => {
  it('moves to a picked scene', () => {
    expect(nextScene(playing, 3, { pick: 2 })).toEqual({ index: 2, paused: false })
  })

  it('pauses, and play clears pause', () => {
    const paused = nextScene(playing, 3, 'pause')
    expect(paused).toEqual({ index: 0, paused: true })
    expect(nextScene(paused, 3, 'play')).toEqual(playing)
  })

  it('keeps pause across a pick', () => {
    expect(nextScene({ ...playing, paused: true }, 3, { pick: 1 })).toEqual({
      index: 1,
      paused: true,
    })
  })

  it('ignores a pick out of range', () => {
    expect(nextScene(playing, 3, { pick: 3 })).toEqual(playing)
    expect(nextScene(playing, 3, { pick: -1 })).toEqual(playing)
  })
})
