import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { testSession } from '../../test/fakeSync'
import { dataProviders } from '../../test/providers'
import {
  entitlementRow,
  linkRow,
  recordingFile,
  recordingRow,
  tuneRow,
  userSettingsRow,
  userTuneRow,
} from '../../test/rows'
import { useTuneSource } from './useTuneSource'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await db.tunes.put(tuneRow('t1', "Soldier's Joy"))
})

function render() {
  return renderHook(() => useTuneSource('t1'), { wrapper: dataProviders({ db }) })
}

async function addRecording() {
  await db.recordings.put(recordingRow('R', { tune_id: 't1' }))
  await db.recording_files.put(recordingFile('R'))
}

describe('useTuneSource', () => {
  it('ignores a pin on a deleted user row', async () => {
    await addRecording()
    await db.recording_links.put(linkRow('L', 't1'))
    await db.user_tunes.put(
      userTuneRow('u-old', 't1', { play_link_id: 'L', deleted_at: '2026-02-01T00:00:00.000Z' }),
    )
    await db.user_tunes.put(userTuneRow('u1', 't1'))
    const { result } = render()
    await expect
      .poll(() => result.current)
      .toMatchObject({ kind: 'recording', view: { recording: { id: 'R' } } })
  })

  it('plays the pinned link over a recording', async () => {
    await addRecording()
    await db.recording_links.put(linkRow('L', 't1'))
    await db.user_tunes.put(userTuneRow('u1', 't1', { play_link_id: 'L' }))
    const { result } = render()
    await expect.poll(() => result.current).toMatchObject({ kind: 'link', link: { id: 'L' } })
  })

  it('follows Play first for Apple Music', async () => {
    await addRecording()
    await db.recording_links.put(linkRow('L', 't1', { provider: 'apple_music' }))
    await db.user_settings.put(
      userSettingsRow(settingsId(testSession.userId), { play_first: 'apple_music' }),
    )
    const { result } = render()
    await expect.poll(() => result.current).toMatchObject({ kind: 'link', link: { id: 'L' } })
  })

  it('falls back to a link on a free plan', async () => {
    await addRecording()
    await db.recording_links.put(linkRow('L', 't1', { provider: 'youtube' }))
    await db.entitlements.put(entitlementRow())
    const { result } = render()
    await expect.poll(() => result.current).toMatchObject({ kind: 'link', link: { id: 'L' } })
  })

  it('passes over a pinned recording with no audio anywhere to a link', async () => {
    await db.recordings.put(recordingRow('R', { tune_id: 't1', state: 'uploaded' }))
    await db.recording_files.put(recordingFile('R'))
    await db.recording_links.put(linkRow('L', 't1'))
    await db.user_tunes.put(userTuneRow('u1', 't1', { play_recording_id: 'R' }))
    const { result } = render()
    await expect.poll(() => result.current).toMatchObject({ kind: 'link', link: { id: 'L' } })
  })

  it('keeps a recording only the server holds, which plays once fetched', async () => {
    await addRecording()
    const { result } = render()
    await expect
      .poll(() => result.current)
      .toMatchObject({ kind: 'recording', view: { recording: { id: 'R' } } })
  })

  it('passes over a recording only the server holds to a link while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await addRecording()
    await db.recording_links.put(linkRow('L', 't1'))
    const { result } = render()
    await expect.poll(() => result.current).toMatchObject({ kind: 'link', link: { id: 'L' } })
  })

  it('keeps the loaded recording though it can no longer play', async () => {
    await db.recordings.put(recordingRow('R', { tune_id: 't1', state: 'uploaded' }))
    await db.recording_files.put(recordingFile('R'))
    await db.recording_links.put(linkRow('L', 't1'))
    const { result } = renderHook(() => useTuneSource('t1', 'R'), {
      wrapper: dataProviders({ db }),
    })
    await expect
      .poll(() => result.current)
      .toMatchObject({ kind: 'recording', view: { recording: { id: 'R' } } })
  })

  it('is null for a tune with nothing', async () => {
    const { result } = render()
    await expect.poll(() => result.current).toBeNull()
  })
})
