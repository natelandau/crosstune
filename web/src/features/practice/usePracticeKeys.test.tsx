import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PlaybackEngine } from '../player/playbackEngine'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import { ARROW_LARGE_STEP_MS, ARROW_STEP_MS } from './PracticeWaveform'
import { type PracticeKeyActions, usePracticeKeys } from './usePracticeKeys'

const TRIM_START_MS = 1000
const SHOWN_MS = 10_000

function setup(overrides: Partial<PracticeKeyActions> = {}) {
  const seek = vi.fn()
  const engine = { getState: () => ({ lengthMs: 60_000 }), seek } as unknown as PlaybackEngine
  const actions: PracticeKeyActions = {
    scope: { root: { current: document.body } },
    isTop: () => true,
    canEdit: true,
    trimStartMs: TRIM_START_MS,
    settle: vi.fn(),
    shownPositionMs: () => SHOWN_MS,
    selectedId: null,
    isRenaming: () => false,
    togglePlay: vi.fn(),
    setEdge: vi.fn(),
    create: vi.fn(),
    loopCount: 2,
    selectLoop: vi.fn((index: number) => [5000, 20_000][index]!),
    removeSelected: vi.fn(),
    startRename: vi.fn(),
    endRename: vi.fn(),
    deselect: vi.fn(),
    zoom: vi.fn(),
    ...overrides,
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlaybackEngineContext.Provider value={engine}>{children}</PlaybackEngineContext.Provider>
  )
  renderHook(() => usePracticeKeys(undefined, actions), { wrapper })
  return { actions, seek }
}

/** A key pressed with focus on nothing, as practice hears it. */
function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  document.body.dispatchEvent(event)
  return event
}

describe('usePracticeKeys', () => {
  it('nudges the playhead with the arrows, further with Shift', () => {
    const { actions, seek } = setup()
    expect(press('ArrowRight').defaultPrevented).toBe(true)
    expect(seek).toHaveBeenLastCalledWith(SHOWN_MS + ARROW_STEP_MS)
    press('ArrowLeft', { shiftKey: true })
    expect(seek).toHaveBeenLastCalledWith(SHOWN_MS - ARROW_LARGE_STEP_MS)
    expect(actions.settle).toHaveBeenCalledTimes(2)
  })

  it('makes a new loop at the playhead with N or L, either case', () => {
    const { actions } = setup()
    for (const key of ['n', 'N', 'l', 'L']) press(key)
    expect(vi.mocked(actions.create).mock.calls).toEqual(Array(4).fill([TRIM_START_MS + SHOWN_MS]))
  })

  it('picks a loop by its number and brings its start under the playhead', () => {
    const { actions, seek } = setup()
    expect(press('2').defaultPrevented).toBe(true)
    expect(actions.selectLoop).toHaveBeenCalledExactlyOnceWith(1)
    expect(seek).toHaveBeenCalledExactlyOnceWith(20_000 - TRIM_START_MS)
  })

  it('leaves a number past the last loop alone', () => {
    const { actions, seek } = setup()
    expect(press('3').defaultPrevented).toBe(false)
    expect(actions.selectLoop).not.toHaveBeenCalled()
    expect(seek).not.toHaveBeenCalled()
  })
})
