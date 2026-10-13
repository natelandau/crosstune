import { devices, expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NEW_RECORDING, STOP } from '../src/features/capture/recordCopy'
import {
  FIRST_RECORDING_TITLE,
  NOTICE_OK,
  TRIAL_ENDED_TITLE,
} from '../src/features/plan/noticeCopy'
import { CHOOSE_SCAN_FILES, openScanName } from '../src/features/scans/scanCopy'
import {
  EXPORT_ACTION,
  EXPORT_COMPLETE_NOTE,
  EXPORT_DATA,
  EXPORT_TITLE,
} from '../src/features/settings/export/exportCopy'
import { IMPORT_AND_EXPORT } from '../src/features/settings/settingsCopy'
import { ADD_RECORDING } from '../src/features/tune/tuneMediaCopy'
import { RECORDINGS_SECTION, recordingsLine } from '../src/features/tune/tuneScreenCopy'
import { CLOSE } from '../src/ui/confirmCopy'
import {
  addTune,
  createThrowawayUser,
  DEFAULT_LABEL,
  endTrial,
  expectNoOverlay,
  openSetting,
  openTab,
  removeClerkUser,
  signInAs,
  tunePage,
  unique,
  waitForReady,
} from './helpers'

const SCAN = fileURLToPath(new URL('./fixtures/scan.jpg', import.meta.url))

// The Stop button pulses while recording, so Playwright never sees it stable without this.
test.use({ reducedMotion: 'reduce' })

/** Open the export sheet from Settings and press Export, returning the zip's entries. */
async function exportZip(page: Page): Promise<Record<string, Uint8Array>> {
  await openSetting(page, IMPORT_AND_EXPORT)
  await page.getByRole('button', { name: EXPORT_DATA }).click()
  const sheet = page.getByRole('dialog', { name: EXPORT_TITLE })
  await expect(sheet.getByText(EXPORT_COMPLETE_NOTE)).toBeVisible()
  const download = page.waitForEvent('download')
  await sheet.getByRole('button', { name: EXPORT_ACTION, exact: true }).click()
  const path = await (await download).path()
  return unzipSync(new Uint8Array(readFileSync(path)))
}

interface DeviceFiles {
  recordings: number
  audioOnDevice: number
  scans: { tuneId: string; onDevice: boolean }[]
}

/** What the signed-in user's local database holds, read straight from IndexedDB. */
function deviceFiles(page: Page): Promise<DeviceFiles> {
  return page.evaluate(async () => {
    const [info] = (await indexedDB.databases()).filter((db) => db.name?.startsWith('crosstune-'))
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(info!.name!)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result as T[])
        request.onerror = () => reject(request.error)
      })
    const [recordings, files, scans, scanFiles] = await Promise.all([
      all<{ deleted_at: string | null }>('recordings'),
      all<{ blob: Blob | null }>('recording_files'),
      all<{ id: string; tune_id: string; deleted_at: string | null }>('scans'),
      all<{ id: string }>('scan_files'),
    ])
    db.close()
    const held = new Set(scanFiles.map((file) => file.id))
    return {
      recordings: recordings.filter((row) => !row.deleted_at).length,
      audioOnDevice: files.filter((file) => file.blob).length,
      scans: scans
        .filter((scan) => !scan.deleted_at)
        .map((scan) => ({ tuneId: scan.tune_id, onDevice: held.has(scan.id) }))
        .sort((a, b) => Number(b.onDevice) - Number(a.onDevice)),
    }
  })
}

/** Close a plan notice, which opens on its own once nothing else is on screen, with the action
 * that closes it. */
async function dismissNotice(page: Page, title: string, button = NOTICE_OK): Promise<void> {
  await page
    .getByRole('dialog', { name: title })
    .getByRole('button', { name: button, exact: true })
    .click()
  await expectNoOverlay(page)
}

test('exports the library as a zip download', async ({ page }) => {
  const { id, emailAddress } = await createThrowawayUser()
  try {
    await signInAs(page, emailAddress)
    await addTune(page, unique("Cooley's"), 'D')

    await openSetting(page, IMPORT_AND_EXPORT)
    await page.getByRole('button', { name: EXPORT_DATA }).click()
    const download = page.waitForEvent('download')
    await page
      .getByRole('dialog', { name: EXPORT_TITLE })
      .getByRole('button', { name: EXPORT_ACTION, exact: true })
      .click()

    expect((await download).suggestedFilename()).toMatch(
      /^crosstune-export-\d{4}-\d{2}-\d{2}\.zip$/,
    )
  } finally {
    await removeClerkUser(id)
  }
})

test('an account whose trial has ended exports every recording and scan', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const { id, emailAddress } = await createThrowawayUser()
  try {
    await signInAs(page, emailAddress)
    // Scans on two tunes: on the free plan only the first tune's open, so a fresh device
    // never downloads the second's and the export has to fetch it.
    const first = unique('Sally Goodin')
    await addTune(page, first, 'A')
    const firstUrl = page.url()
    await page.getByLabel(CHOOSE_SCAN_FILES).setInputFiles(SCAN)
    await expect(tunePage(page).getByRole('button', { name: openScanName(0) })).toBeVisible()

    await openTab(page, 'catalog')
    await addTune(page, unique('Forked Deer'), 'D')
    await page.getByLabel(CHOOSE_SCAN_FILES).setInputFiles(SCAN)
    await expect(tunePage(page).getByRole('button', { name: openScanName(0) })).toBeVisible()

    await page.goto(firstUrl)
    await tunePage(page).getByRole('button', { name: ADD_RECORDING, exact: true }).click()
    await page
      .getByRole('menu', { name: ADD_RECORDING })
      .getByRole('menuitem', { name: NEW_RECORDING, exact: true })
      .click()
    const recorder = page.getByRole('dialog', { name: NEW_RECORDING })
    await expect(recorder.getByRole('timer')).toHaveText(/^0:0[3-9]$/, { timeout: 15_000 })
    await recorder.getByRole('button', { name: STOP, exact: true }).click()
    await dismissNotice(page, FIRST_RECORDING_TITLE)

    const row = tunePage(page)
      .getByRole('grid', { name: RECORDINGS_SECTION })
      .getByRole('row')
      .first()
    await expect(row).toContainText(DEFAULT_LABEL)
    // Scans upload ahead of recordings in each transfer pass, so a ready recording means
    // both scans are stored too.
    await waitForReady(page, row, {
      timeout: 120_000,
      restore: async () => {
        await page.goto(firstUrl)
        await expect(row).toBeVisible()
      },
    })

    endTrial(id)

    const freshDevice = await browser.newContext({ ...devices['Pixel 7'] })
    try {
      const page2 = await freshDevice.newPage()
      await signInAs(page2, emailAddress)
      await dismissNotice(page2, TRIAL_ENDED_TITLE, CLOSE)
      await page2.goto(firstUrl)
      await expect(tunePage(page2).getByText(recordingsLine(1), { exact: true })).toBeVisible()
      // Both scan rows have arrived, the scan tune's image has downloaded, and neither the
      // audio nor the other tune's image is here, so the export can only get them by fetching.
      const firstTuneId = new URL(firstUrl).pathname.split('/').at(-1)!
      await expect
        .poll(() => deviceFiles(page2), { timeout: 30_000 })
        .toEqual({
          recordings: 1,
          audioOnDevice: 0,
          scans: [
            { tuneId: firstTuneId, onDevice: true },
            { tuneId: expect.not.stringMatching(`^${firstTuneId}$`), onDevice: false },
          ],
        })

      const files = await exportZip(page2)
      const audio = Object.keys(files).filter((path) => path.startsWith('recordings/'))
      const scans = Object.keys(files).filter((path) => path.startsWith('scans/'))
      expect(audio).toHaveLength(1)
      expect(scans).toHaveLength(2)
      for (const path of [...audio, ...scans]) expect(files[path]!.length).toBeGreaterThan(0)
    } finally {
      await freshDevice.close()
    }
  } finally {
    await removeClerkUser(id)
  }
})
