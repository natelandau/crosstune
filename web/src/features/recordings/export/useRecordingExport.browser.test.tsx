import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { openTestDb } from '../../../test/db'
import { dataProviders } from '../../../test/providers'
import { recordingFile, recordingRow } from '../../../test/rows'
import { recordingAnalytics } from '../../../usage/testing'
import type { RecordingView } from '../useRecordings'
import { useRecordingExport } from './useRecordingExport'

it.each(['cancelled', 'unmounted'] as const)(
  'delivers nothing and sends no event when %s while the share sheet is open',
  async (how) => {
    let closeSheet = () => {}
    const sheet = new Promise<void>((resolve) => (closeSheet = resolve))
    const share = vi.fn(() => sheet)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    onTestFinished(() => {
      delete (navigator as { share?: unknown }).share
    })
    const analytics = recordingAnalytics()
    const { result, unmount } = renderHook(() => useRecordingExport(), {
      wrapper: dataProviders({ db: openTestDb(), analytics }),
    })
    const blob = new Blob(['local'], { type: 'audio/mp4' })
    const view: RecordingView = {
      recording: recordingRow('r1', { label: 'Jam' }),
      file: recordingFile('r1', { blob, local_state: 'uploaded' }),
      tuneId: null,
      tuneTitle: null,
      holdsSplitAudio: false,
    }

    act(() => result.current.exportOne(view, 'share'))
    await expect.poll(() => share.mock.calls.length).toBe(1)
    if (how === 'cancelled') act(() => result.current.cancel())
    else unmount()
    await act(async () => closeSheet())

    if (how === 'cancelled') expect(result.current.state).toEqual({ kind: 'idle' })
    expect(analytics.sends().filter((send) => send.name === 'recording_exported')).toEqual([])
  },
)
