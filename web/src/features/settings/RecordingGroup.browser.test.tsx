import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { clearDownloadedBlobs, storeDownloadedBlob } from '../../commands/recordings'
import { setAudioQuality, settingsId } from '../../commands/settings'
import { getKeepOffline } from '../../db/meta'
import { pendingBatch } from '../../db/outbox'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import type { SyncEngine } from '../../sync/types'
import {
  KEEP_OFFLINE_LABEL,
  QUALITY_FOOTER,
  RecordingGroup,
  REMOVE_DOWNLOADS,
  REMOVE_DOWNLOADS_FOOTER,
} from './RecordingGroup'

vi.mock('../../commands/settings', { spy: true })
vi.mock('../../commands/recordings', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

const show = (engine?: SyncEngine) => renderIonic(<RecordingGroup />, { db, engine })

const keepToggle = () => page.getByRole('switch', { name: KEEP_OFFLINE_LABEL })
const clearButton = () => page.getByRole('button', { name: REMOVE_DOWNLOADS })

/** The name a screen reader announces for the quality row: the field and the preset it holds. */
const qualityRow = (preset: string) =>
  page.getByRole('button', { name: `Quality, ${preset}`, exact: true })

/** Ionic's own inner button takes no clicks, so the row is what opens the picker. */
async function openQuality(preset: string) {
  // Ionic ignores a present while the previous popover is still dismissing.
  await vi.waitFor(() =>
    expect(document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull(),
  )
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: `Quality, ${preset}` }) })
    .click()
}

async function chooseQuality(from: string, to: string) {
  await openQuality(from)
  await page.getByRole('radio', { name: to, exact: true }).click()
}

/** Replaces navigator so the permission prompt the toggle raises can be counted. */
function stubPersist() {
  const persist = vi.fn(async () => true)
  vi.stubGlobal('navigator', { storage: { persist } })
  return persist
}

/** A ready recording with a blob, the only shape clearDownloadedBlobs will drop. */
async function seedDownload(bytes: string) {
  const at = '2026-09-14T20:00:00.000Z'
  await storeDownloadedBlob(db, 'r1', new Blob([bytes]), 'audio/mp4')
  await db.recordings.put({
    id: 'r1',
    created_at: at,
    updated_at: at,
    deleted_at: null,
    server_seq: 1,
    tune_id: null,
    label: null,
    source: 'microphone',
    recorded_at: at,
    position: 0,
    state: 'ready',
    duration_ms: 1000,
    playback_mime: 'audio/mp4',
    playback_bytes: bytes.length,
    error: null,
  })
}

describe('RecordingGroup', () => {
  it('names the quality row, its preset, and its rate, with no settings row', async () => {
    show()
    await expect.element(page.getByRole('heading', { name: 'Recording', level: 2 })).toBeVisible()
    await expect.element(qualityRow('Standard, 64 kbps')).toBeInTheDocument()
    expect(await db.user_settings.toArray()).toEqual([])
  })

  it('offers every preset with the rate it records at', async () => {
    show()
    await openQuality('Standard, 64 kbps')
    await expect.element(page.getByRole('radio', { name: 'Low, 48 kbps' })).toBeVisible()
    expect(
      page
        .getByRole('radio')
        .elements()
        .map((option) => option.textContent?.trim()),
    ).toEqual(['Low, 48 kbps', 'Standard, 64 kbps', 'High, 128 kbps'])
  })

  it('stores a chosen quality and queues one settings change', async () => {
    show()
    await chooseQuality('Standard, 64 kbps', 'High, 128 kbps')
    await expect
      .poll(async () => (await db.user_settings.get(settingsId('user_1')))?.audio_quality)
      .toBe('high')
    await expect.element(qualityRow('High, 128 kbps')).toBeInTheDocument()
    expect((await pendingBatch(db, 10)).map((entry) => entry.table)).toEqual(['user_settings'])
  })

  it('starts with downloads off and removal available', async () => {
    show()
    await expect.element(keepToggle()).not.toBeChecked()
    await expect.element(clearButton()).toBeEnabled()
    await expect.element(page.getByText(KEEP_OFFLINE_LABEL)).toBeVisible()
  })

  it('downloads everything, starts a transfer, and asks to keep the storage', async () => {
    const persist = stubPersist()
    const transfer = vi.fn(async () => {})
    show(fakeEngine({ transfer }))
    await keepToggle().click()
    await expect.poll(() => getKeepOffline(db)).toBe(true)
    await expect.element(keepToggle()).toBeChecked()
    expect(transfer).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledOnce()
    // Removing downloads while every recording is kept offline would only re-download them.
    await expect.element(clearButton()).toBeDisabled()
  })

  it('turns downloads off without transferring, asking again, or dropping a blob', async () => {
    const persist = stubPersist()
    const transfer = vi.fn(async () => {})
    await seedDownload('12345')
    show(fakeEngine({ transfer }))
    await keepToggle().click()
    await expect.poll(() => getKeepOffline(db)).toBe(true)
    await expect.element(clearButton()).toBeDisabled()

    await keepToggle().click()
    await expect.poll(() => getKeepOffline(db)).toBe(false)
    await expect.element(clearButton()).toBeEnabled()
    expect(transfer).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledOnce()
    expect((await db.recording_files.get('r1'))?.blob).not.toBeNull()
  })

  it('reads zero bytes before the size query has answered', () => {
    show()
    expect(document.body.textContent).toContain('0 B of audio on this device')
  })

  it('names what is on the device and removes it', async () => {
    await seedDownload('12345')
    show()
    await expect.element(page.getByText('5 B of audio on this device')).toBeVisible()
    await clearButton().click()
    await expect.poll(async () => (await db.recording_files.get('r1'))?.blob).toBeNull()
    await expect.element(page.getByText('0 B of audio on this device')).toBeVisible()
  })

  it('shows a refused quality under quality, and clears it on the next choice', async () => {
    vi.mocked(setAudioQuality).mockRejectedValue(new Error('Settings are read-only'))
    show()
    await chooseQuality('Standard, 64 kbps', 'High, 128 kbps')
    await expect.element(page.getByRole('alert')).toHaveTextContent('Settings are read-only')
    expect(page.getByText(QUALITY_FOOTER).elements()).toHaveLength(0)
    await expect.element(page.getByText(REMOVE_DOWNLOADS_FOOTER)).toBeVisible()

    vi.mocked(setAudioQuality).mockRestore()
    await chooseQuality('Standard, 64 kbps', 'Low, 48 kbps')
    await expect
      .poll(async () => (await db.user_settings.get(settingsId('user_1')))?.audio_quality)
      .toBe('low')
    await expect.element(page.getByText(QUALITY_FOOTER)).toBeVisible()
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('shows a refused removal under storage, not under quality', async () => {
    vi.mocked(clearDownloadedBlobs).mockRejectedValue(new Error('Storage is busy'))
    show()
    await clearButton().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Storage is busy')
    expect(page.getByText(REMOVE_DOWNLOADS_FOOTER).elements()).toHaveLength(0)
    await expect.element(page.getByText(QUALITY_FOOTER)).toBeVisible()
  })

  it('wraps the downloads label rather than cutting it off on a narrow phone', async () => {
    await page.viewport(320, 844)
    try {
      show()
      await expect.element(keepToggle()).toBeVisible()
      // Ionic renders the label inside the toggle's shadow root, where the clipping lives.
      const label = document
        .querySelector('ion-toggle')!
        .shadowRoot!.querySelector('[part~=label]')!
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('gives every control a tap target a finger can hit', async () => {
    show()
    await expect.element(clearButton()).toBeVisible()
    for (const item of document.querySelectorAll('ion-item')) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
