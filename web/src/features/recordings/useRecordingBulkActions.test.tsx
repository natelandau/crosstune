import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { deleteRecordings } from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { recordingAnalytics } from '../../usage/testing'
import { PlayerContext } from '../player/usePlayer'
import { useRecordingBulkActions } from './useRecordingBulkActions'
import type { RecordingView } from './useRecordings'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const view = (recording: RecordingView['recording']): RecordingView => ({
  recording,
  file: undefined,
  tuneId: recording.tune_id ?? null,
  tuneTitle: null,
  holdsSplitAudio: false,
})

it('links past a recording deleted since it was selected and reports only the moved one', async () => {
  const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' })
  const kept = recordingRow('kept')
  const gone = recordingRow('gone')
  await db.recordings.bulkPut([kept, gone])
  await deleteRecordings(db, ['gone'])
  const analytics = recordingAnalytics()
  const Data = dataProviders({ db, analytics })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={fakePlayer()}>{children}</PlayerContext.Provider>
    </Data>
  )
  const onExit = vi.fn()
  const { result } = renderHook(
    () =>
      useRecordingBulkActions({
        active: true,
        views: [view(kept), view(gone)],
        onExit,
        confirm: vi.fn(),
        toast: vi.fn(),
      }),
    { wrapper },
  )

  act(() => result.current.link({ id: tuneId, title: 'Reel' }))

  await vi.waitFor(() => expect(onExit).toHaveBeenCalled())
  expect(result.current.error).toBeNull()
  expect(
    analytics
      .sends()
      .filter((send) => send.name === 'recording_filed')
      .map((send) => (send.props as { recording_id: string }).recording_id),
  ).toEqual(['kept'])
})

it.each(['link', 'download'])('closes the %s sheet when the mode ends', (button) => {
  const Data = dataProviders({ db, analytics: recordingAnalytics() })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={fakePlayer()}>{children}</PlayerContext.Provider>
    </Data>
  )
  // Still processing, so the download sheet waits on what it leaves out.
  const views = [view(recordingRow('r1', { state: 'pending_upload' }))]
  const { result, rerender } = renderHook(
    ({ active }) =>
      useRecordingBulkActions({ active, views, onExit: vi.fn(), confirm: vi.fn(), toast: vi.fn() }),
    { wrapper, initialProps: { active: true } },
  )
  act(() => result.current.buttons.find(({ id }) => id === button)!.onPress!())
  const open = () => result.current.linkOpen || result.current.exporting.open
  expect(open()).toBe(true)

  rerender({ active: false })

  expect(open()).toBe(false)
})
