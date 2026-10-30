import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { entitlementRow, recordingFile, recordingRow } from '../../test/rows'
import { DELETE } from '../../ui/confirmCopy'
import { PlayerContext } from '../player/usePlayer'
import { TRIM } from '../practice/trimCopy'
import { DELETE_WHILE_SPLITTING, SPLIT } from '../practice/splitCopy'
import { DETACHED_PRACTICE_OVERLAY, PracticeOverlayContext } from '../practice/usePracticeOverlay'
import { PREMIUM_RECORDINGS_TITLE } from '../plan/planCopy'
import { MAX_RECORDING_MS } from '../../domain/recordingLimits'
import { EDIT, openOn, ADD_TO_TUNE } from './recordingCopy'
import { GO_TO_TUNE } from './recordingNames'
import { PLAY_FIRST_IN_LISTS } from '../tune/playSourceText'
import type { RecordingView } from './useRecordings'
import {
  REMOVE_FROM_TUNE,
  useRecordingActionsWith,
  type RecordingActionsOptions,
} from './useRecordingActionsWith'

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
  const open = vi.fn()
  const overlay = { ...DETACHED_PRACTICE_OVERLAY, open }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PracticeOverlayContext.Provider value={overlay}>
        <PlayerContext.Provider value={fakePlayer()}>{children}</PlayerContext.Provider>
      </PracticeOverlayContext.Provider>
    </Data>
  )
  const confirm = vi.fn(async () => answer)
  const { result } = renderHook(() => useRecordingActionsWith({ confirm, ...options }), { wrapper })
  return {
    get current() {
      return result.current
    },
    confirm,
    open,
  }
}

const labels = (items: { label: string }[]) => items.map((item) => item.label)

describe('useRecordingActionsWith', () => {
  it('offers Trim first, only in the menu', () => {
    const result = setup({ onEdit: () => {}, onTrim: () => {}, onAddToTune: () => {} })
    expect(labels(result.current.menuFor(view()))).toEqual([TRIM, EDIT, ADD_TO_TUNE, DELETE])
    expect(labels(result.current.actionsFor(view()))).not.toContain(TRIM)
    expect(result.current.menuFor(view())[0]).toMatchObject({ disabled: undefined })
  })

  it('shows Trim disabled with its reason while it is blocked', () => {
    const result = setup({ onTrim: () => {}, trimBlocked: 'Offline' })
    expect(result.current.menuFor(view())[0]).toMatchObject({ label: TRIM, disabled: 'Offline' })
  })

  it('offers Open on the site only for an import whose page is http or https', () => {
    const result = setup()
    const page = 'https://www.slippery-hill.com/content/x'
    expect(labels(result.current.menuFor(view({ origin_url: page })))).toContain(
      openOn('Slippery-Hill'),
    )
    for (const url of ['javascript:alert(1)', 'garbage', null]) {
      expect(labels(result.current.menuFor(view({ origin_url: url })))).not.toContain(
        openOn('Slippery-Hill'),
      )
    }
  })

  it('offers Split first on a row that must be split to upload, opening practice on Split', () => {
    const result = setup({ onEdit: () => {} })
    const long = view({
      file: recordingFile('r1', {
        blob: new Blob(['x']),
        local_duration_ms: MAX_RECORDING_MS + 1000,
      }),
    })
    const split = result.current.actionsFor(long)[0]!
    expect(split).toMatchObject({ label: SPLIT, disabled: undefined })
    split.onPress()
    expect(result.open).toHaveBeenCalledWith('r1', 'split')
    expect(labels(result.current.actionsFor(view()))).not.toContain(SPLIT)
  })

  it('swipes Split, one filing action, and Delete on a row that must be split', () => {
    const file = recordingFile('r1', {
      blob: new Blob(['x']),
      local_duration_ms: MAX_RECORDING_MS + 1000,
    })
    const result = setup({
      onEdit: () => {},
      onAddToTune: () => {},
      onOpenTune: () => {},
      pin: { userTuneId: 'ut1', recordingId: null },
    })
    const unfiled = view({ file })
    expect(labels(result.current.actionsFor(unfiled))).toEqual([SPLIT, ADD_TO_TUNE, DELETE])
    expect(labels(result.current.rowMenuFor(unfiled))).toEqual([
      SPLIT,
      EDIT,
      ADD_TO_TUNE,
      PLAY_FIRST_IN_LISTS,
      DELETE,
    ])
    const filed = view({ file, tuneId: 't1', tuneTitle: 'Cluck Old Hen' })
    expect(labels(result.current.actionsFor(filed))).toEqual([SPLIT, REMOVE_FROM_TUNE, DELETE])
    expect(labels(result.current.rowMenuFor(filed))).toEqual([
      SPLIT,
      EDIT,
      REMOVE_FROM_TUNE,
      GO_TO_TUNE,
      PLAY_FIRST_IN_LISTS,
      DELETE,
    ])
    const unfilable = setup().current
    expect(labels(unfilable.actionsFor(unfiled))).toEqual([SPLIT, DELETE])
  })

  it('swipes and lists the same actions on a row that need not be split', () => {
    const result = setup({ onEdit: () => {}, onAddToTune: () => {} })
    expect(labels(result.current.actionsFor(view()))).toEqual([EDIT, ADD_TO_TUNE, DELETE])
    expect(labels(result.current.rowMenuFor(view()))).toEqual([EDIT, ADD_TO_TUNE, DELETE])
  })

  it('waits to delete a recording only while it holds split audio', () => {
    const result = setup()
    const deleteOf = (target: RecordingView) =>
      result.current.actionsFor(target).find((action) => action.label === DELETE)?.disabled
    expect(deleteOf(view({ holdsSplitAudio: true }))).toBe(DELETE_WHILE_SPLITTING)
    expect(deleteOf(view())).toBeUndefined()
  })

  it('shows Split disabled with its reason on a free plan', async () => {
    await db.entitlements.put(entitlementRow())
    const result = setup()
    const long = view({
      file: recordingFile('r1', {
        blob: new Blob(['x']),
        local_duration_ms: MAX_RECORDING_MS + 1000,
      }),
    })
    await expect
      .poll(() => result.current.actionsFor(long)[0]?.disabled)
      .toBe(PREMIUM_RECORDINGS_TITLE)
  })

  it('offers Go to tune after Remove from tune, on a filed view with a handler only', () => {
    const filed = view({ tuneId: 't1', tuneTitle: 'Cluck Old Hen' })
    const withHandler = setup({ onOpenTune: () => {} })
    expect(labels(withHandler.current.menuFor(filed))).toEqual([
      REMOVE_FROM_TUNE,
      GO_TO_TUNE,
      DELETE,
    ])
    expect(labels(withHandler.current.menuFor(view()))).not.toContain(GO_TO_TUNE)
    expect(labels(setup().current.menuFor(filed))).not.toContain(GO_TO_TUNE)
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

    it('sends recording_unfiled with the origin from Remove from tune', async () => {
      const analytics = recordingAnalytics()
      const result = setup({}, false, analytics)
      const target = view({ tuneId: 't1', tuneTitle: 'Cluck Old Hen' })
      await db.recordings.put({ ...target.recording, tune_id: 't1', source: 'upload' })
      const upload = { ...target, recording: { ...target.recording, source: 'upload' as const } }

      pressAction(result, upload, REMOVE_FROM_TUNE)

      await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBeNull()
      await expect
        .poll(() => analytics.sends())
        .toEqual([{ name: 'recording_unfiled', props: { origin: 'imported', recording_id: 'r1' } }])
    })
  })
})
