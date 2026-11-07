import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { recordingFile, recordingRow } from '../../test/rows'
import { DELETE } from '../../ui/confirmCopy'
import { PlayerContext } from '../player/usePlayer'
import { TRIM } from '../practice/trimCopy'
import { DELETE_WHILE_SPLITTING, SPLIT } from '../practice/splitCopy'
import { MAX_RECORDING_MS } from '../../domain/recordingLimits'
import { openOn } from './recordingCopy'
import { GO_TO_TUNE } from './recordingNames'
import { DONT_PLAY_FIRST, PLAY_FIRST_IN_LISTS } from '../tune/playSourceText'
import type { RecordingView } from './useRecordings'
import { useRecordingActionsWith, type RecordingActionsOptions } from './useRecordingActionsWith'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function view(overrides: Partial<RecordingView> & { origin_url?: string | null } = {}) {
  const { origin_url = null, ...rest } = overrides
  return {
    recording: recordingRow('r1', {
      label: 'Jam recording',
      origin: origin_url ? 'slippery_hill' : 'own',
      origin_url,
    }),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
    ...rest,
  } satisfies RecordingView
}

function setup(
  options: RecordingActionsOptions = {},
  answer = false,
  analytics = recordingAnalytics(),
) {
  const Data = dataProviders({ db, analytics })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={fakePlayer()}>{children}</PlayerContext.Provider>
    </Data>
  )
  const confirm = vi.fn(async () => answer)
  const { result } = renderHook(() => useRecordingActionsWith({ confirm, ...options }), { wrapper })
  return {
    get current() {
      return result.current
    },
    confirm,
  }
}

const labels = (items: { label: string }[]) => items.map((item) => item.label)

describe('useRecordingActionsWith', () => {
  it('offers Trim first, only in the menu', () => {
    const result = setup({ onTrim: () => {} })
    expect(labels(result.current.pageMenuFor(view()))).toEqual([TRIM, DELETE])
    expect(labels(result.current.actionsFor(view()))).not.toContain(TRIM)
    expect(result.current.pageMenuFor(view())[0]).toMatchObject({ disabled: undefined })
  })

  it('shows Trim disabled with its reason while it is blocked', () => {
    const result = setup({ onTrim: () => {}, trimBlocked: 'Offline' })
    expect(result.current.pageMenuFor(view())[0]).toMatchObject({
      label: TRIM,
      disabled: 'Offline',
    })
  })

  it('offers Open on the site only for an import whose page is http or https', () => {
    const result = setup()
    const page = 'https://www.slippery-hill.com/content/x'
    expect(labels(result.current.pageMenuFor(view({ origin_url: page })))).toContain(
      openOn('Slippery-Hill'),
    )
    for (const url of ['javascript:alert(1)', 'garbage', null]) {
      expect(labels(result.current.pageMenuFor(view({ origin_url: url })))).not.toContain(
        openOn('Slippery-Hill'),
      )
    }
  })

  it("a row's only swipe and menu action is Delete", () => {
    const file = recordingFile('r1', {
      blob: new Blob(['x']),
      local_duration_ms: MAX_RECORDING_MS + 1000,
    })
    const result = setup({
      onOpenTune: () => {},
      onTrim: () => {},
      onSplit: () => {},
      pin: { userTuneId: 'ut1', recordingId: null },
    })
    for (const target of [
      view(),
      view({ file }),
      view({ tuneId: 't1', tuneTitle: 'Cluck Old Hen', origin_url: 'https://example.com/x' }),
    ]) {
      expect(labels(result.current.actionsFor(target))).toEqual([DELETE])
    }
  })

  it('the page menu holds Pin, Go to tune, Open on the site, Trim, Split, then Delete', () => {
    const result = setup({
      onOpenTune: () => {},
      onTrim: () => {},
      onSplit: () => {},
      pin: { userTuneId: 'ut1', recordingId: null },
    })
    const filed = view({
      tuneId: 't1',
      tuneTitle: 'Cluck Old Hen',
      origin_url: 'https://www.slippery-hill.com/content/x',
    })
    expect(labels(result.current.pageMenuFor(filed))).toEqual([
      PLAY_FIRST_IN_LISTS,
      GO_TO_TUNE,
      openOn('Slippery-Hill'),
      TRIM,
      SPLIT,
      DELETE,
    ])
  })

  it('offers Split on the page of a recording that must be split to upload', () => {
    const long = view({
      file: recordingFile('r1', {
        blob: new Blob(['x']),
        local_duration_ms: MAX_RECORDING_MS + 1000,
      }),
    })
    const onSplit = vi.fn()
    const result = setup({ onSplit })
    const split = result.current.pageMenuFor(long).find((item) => item.label === SPLIT)!
    expect(split).toMatchObject({ disabled: undefined })
    split.onPress()
    expect(onSplit).toHaveBeenCalledOnce()
  })

  it('offers Pin on the page only with a tune to pin in, and unpins a pinned recording', () => {
    const result = setup({ pin: { userTuneId: 'ut1', recordingId: 'r1' } })
    expect(labels(result.current.pageMenuFor(view()))).toContain(DONT_PLAY_FIRST)
    expect(labels(setup().current.pageMenuFor(view()))).not.toContain(PLAY_FIRST_IN_LISTS)
  })

  it('waits to delete a recording only while it holds split audio', () => {
    const result = setup()
    const deleteOf = (target: RecordingView) =>
      result.current.actionsFor(target).find((action) => action.label === DELETE)?.disabled
    expect(deleteOf(view({ holdsSplitAudio: true }))).toBe(DELETE_WHILE_SPLITTING)
    expect(deleteOf(view())).toBeUndefined()
  })

  it('offers Go to tune on a filed view with a handler only', () => {
    const filed = view({ tuneId: 't1', tuneTitle: 'Cluck Old Hen' })
    const withHandler = setup({ onOpenTune: () => {} })
    expect(labels(withHandler.current.pageMenuFor(filed))).toEqual([GO_TO_TUNE, DELETE])
    expect(labels(withHandler.current.pageMenuFor(view()))).not.toContain(GO_TO_TUNE)
    expect(labels(setup().current.pageMenuFor(filed))).not.toContain(GO_TO_TUNE)
  })

  describe('analytics', () => {
    const pressAction = (result: ReturnType<typeof setup>, target: RecordingView, name: string) =>
      result.current
        .actionsFor(target)
        .find((action) => action.label === name)!
        .onPress()

    it('sends recording_deleted with the origin once a confirmed delete lands', async () => {
      const analytics = recordingAnalytics()
      const result = setup({}, true, analytics)
      const target = view()
      await db.recordings.put(target.recording)

      pressAction(result, target, DELETE)

      await expect.poll(async () => (await db.recordings.get('r1'))?.deleted_at).not.toBeNull()
      await expect
        .poll(() => analytics.sends())
        .toEqual([{ name: 'recording_deleted', props: { origin: 'recorded', recording_id: 'r1' } }])
    })

    it('sends nothing for a declined delete', async () => {
      const analytics = recordingAnalytics()
      const result = setup({}, false, analytics)
      const target = view()
      await db.recordings.put(target.recording)

      pressAction(result, target, DELETE)

      await expect.poll(() => result.confirm.mock.calls.length).toBe(1)
      await expect.poll(async () => (await db.recordings.get('r1'))?.deleted_at).toBeNull()
      expect(analytics.sends()).toEqual([])
    })
  })
})
