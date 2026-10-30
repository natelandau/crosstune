import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { keepLocalUntilSubscribed } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { entitlementRow, recordingFile, recordingRow } from '../../test/rows'
import { PlayerContext } from '../player/usePlayer'
import { LOCAL_UNTIL_SUBSCRIBED } from './recordingCopy'
import { useRecordingRow } from './useRecordingRow'
import type { RecordingView } from './useRecordings'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function wrapperFor(player: ReturnType<typeof fakePlayer>) {
  const Data = dataProviders({ db })
  return ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
    </Data>
  )
}

function renderRow(
  recording = recordingRow('r1', { server_seq: 0, state: 'pending_upload' }),
  player = fakePlayer(),
  file?: RecordingView['file'],
) {
  const view: RecordingView = {
    recording,
    file,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
  }
  return renderHook(() => useRecordingRow(view), { wrapper: wrapperFor(player) })
}

describe('useRecordingRow local-only line', () => {
  it('says a local-only recording waits on this device only while the plan is free', async () => {
    await db.entitlements.put(entitlementRow())
    await keepLocalUntilSubscribed(db, ['r1'])
    const { result } = renderRow()
    await expect.poll(() => result.current.meta).toContain(LOCAL_UNTIL_SUBSCRIBED)

    // The recording is still queued until the next push, but a Premium plan sends it out.
    await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
    await expect.poll(() => result.current.meta).not.toContain(LOCAL_UNTIL_SUBSCRIBED)
  })

  it.each(['captured', 'failed_upload'] as const)(
    'says a stored recording whose %s audio is only on this device waits for Premium',
    async (localState) => {
      await db.entitlements.put(entitlementRow())
      const { result } = renderRow(
        recordingRow('r1', { server_seq: 3, state: 'pending_upload' }),
        fakePlayer(),
        recordingFile('r1', { local_state: localState, blob: new Blob(['audio']) }),
      )
      await expect.poll(() => result.current.meta).toContain(LOCAL_UNTIL_SUBSCRIBED)
    },
  )
})

describe('useRecordingRow on a free plan', () => {
  it('dims a recording the server holds and answers its tap without playing or fetching', async () => {
    await db.entitlements.put(entitlementRow())
    const player = fakePlayer()
    const { result } = renderRow(recordingRow('r1', { state: 'ready' }), player)
    await expect.poll(() => result.current.disabled).toBe(true)
    expect(result.current.control).toBe('play')
    expect(result.current.offlineDownload).toBe(false)
    expect(result.current.open?.openName).toBeNull()
    result.current.open?.onOpen()
    expect(player.play).not.toHaveBeenCalled()
  })

  it('leaves a recording undimmed on a Premium plan', async () => {
    await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
    const { result } = renderRow(recordingRow('r1', { state: 'ready' }))
    await expect.poll(() => result.current.control).toBe('download')
    expect(result.current.disabled).toBe(false)
  })

  it('offers no upload retry while the plan keeps audio local, but keeps a transcode retry', async () => {
    await db.entitlements.put(entitlementRow())
    const file = recordingFile('r1', { local_state: 'failed_upload', blob: new Blob(['audio']) })
    const stuck = renderRow(recordingRow('r1', { server_seq: 3 }), fakePlayer(), file)
    await expect.poll(() => stuck.result.current.meta).toContain(LOCAL_UNTIL_SUBSCRIBED)
    expect(stuck.result.current.retry).toBeNull()

    const failed = renderRow(recordingRow('r2', { state: 'failed' }), fakePlayer())
    await expect.poll(() => failed.result.current.retry).toBe('transcode')
  })

  it('leaves a recording with nothing to play yet undimmed, without a control or a tap', async () => {
    await db.entitlements.put(entitlementRow())
    const view: RecordingView = {
      recording: recordingRow('r1', { state: 'failed' }),
      file: undefined,
      tuneId: null,
      tuneTitle: null,
      holdsSplitAudio: false,
    }
    const { result } = renderHook(
      () => ({ row: useRecordingRow(view), plan: usePlanOrUnknown().kind }),
      { wrapper: wrapperFor(fakePlayer()) },
    )
    await expect.poll(() => result.current.plan).toBe('free')
    expect(result.current.row.control).toBe('none')
    expect(result.current.row.disabled).toBe(false)
    expect(result.current.row.open).toBeUndefined()
  })
})
