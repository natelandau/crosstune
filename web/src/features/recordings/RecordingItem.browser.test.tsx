import { IonList } from '@ionic/react'
import { Pencil } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { MOUSE_QUERY } from '../../platform/pointer'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { recordingFile, recordingRow } from '../../test/rows'
import type { RowAction } from '../../ui/Row'
import { CLOSE_PLAYER } from '../player/Dock'
import type { Player } from '../player/usePlayer'
import { DOWNLOAD_FAILED, WAITING_TO_UPLOAD } from '../recording/format'
import { RecordingItem } from './RecordingItem'
import type { RecordingView } from './useRecordings'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function forceTouch() {
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : originalMatchMedia.call(window, query)
}

function fakePlayer(overrides: Partial<Player> = {}): Player {
  return {
    item: null,
    play: vi.fn(),
    close: vi.fn(),
    returnFocus: vi.fn(),
    ...overrides,
  }
}

function view(
  overrides: {
    recording?: Partial<ReturnType<typeof recordingRow>>
    file?: ReturnType<typeof recordingFile>
    songTitle?: string | null
  } = {},
): RecordingView {
  return {
    recording: recordingRow('r1', { label: 'Jam recording', ...overrides.recording }),
    file: overrides.file,
    songId: null,
    songTitle: overrides.songTitle ?? null,
  }
}

function show(
  recordingView: RecordingView,
  opts: {
    actions?: readonly RowAction[]
    error?: string | null
    engine?: SyncEngine
    player?: Player
    db?: CrosstuneDb
  } = {},
) {
  const onRetry = vi.fn()
  const db = opts.db ?? openTestDb()
  renderIonic(
    <IonList>
      <RecordingItem
        view={recordingView}
        actions={opts.actions}
        error={opts.error}
        onRetry={onRetry}
      />
    </IonList>,
    { db, engine: opts.engine, player: opts.player },
  )
  return { onRetry, db }
}

// The open control's computed name is the verb plus the row's own content (title, then meta),
// per Row's openName contract, so a query for it matches the verb as a leading substring rather
// than the exact string: exact matching would break the moment the meta line's wording changes.
function openControl(name: string) {
  return page.getByRole('button', { name, exact: false })
}

describe('RecordingItem', () => {
  it('plays a held recording from a button named for it', async () => {
    const player = fakePlayer()
    show(view({ file: recordingFile('r1', { blob: new Blob(['x'], { type: 'audio/mp4' }) }) }), {
      player,
    })
    await openControl('Play Jam recording').click()
    expect(player.play).toHaveBeenCalledWith({ kind: 'recording', id: 'r1' })
  })

  it('plays a held recording by tapping anywhere in the row, on touch', async () => {
    forceTouch()
    const player = fakePlayer()
    show(view({ file: recordingFile('r1', { blob: new Blob(['x'], { type: 'audio/mp4' }) }) }), {
      player,
    })
    await expect.element(openControl('Play Jam recording')).toBeVisible()
    // The visible text sits under the open button (pointer-events-none); force mimics the real
    // tap a browser would route to whichever element its hit test finds there.
    await page.getByText('Jam recording').click({ force: true })
    expect(player.play).toHaveBeenCalledWith({ kind: 'recording', id: 'r1' })
  })

  it('closes the loaded recording from a button named for its player', async () => {
    const player = fakePlayer({ item: { kind: 'recording', id: 'r1' } })
    show(view(), { player })
    await openControl(CLOSE_PLAYER).click()
    expect(player.close).toHaveBeenCalled()
  })

  it("keeps a held recording's own state readable alongside the play verb", async () => {
    const player = fakePlayer()
    show(
      view({
        recording: { duration_ms: 42_000 },
        file: recordingFile('r1', {
          blob: new Blob(['x'], { type: 'audio/mp4' }),
          local_state: 'captured',
          upload_attempts: 2,
        }),
      }),
      { player },
    )
    const playButton = openControl('Play Jam recording')
    await expect.element(playButton).toBeVisible()
    const named = playButton.element()
    // Every part of the row's own state names the same one control, not a separate element.
    for (const part of ['0:42', WAITING_TO_UPLOAD, '2 failed tries']) {
      const located = openControl(part)
      await expect.element(located).toBeVisible()
      expect(located.element()).toBe(named)
    }
  })

  it('downloads a ready recording with no blob from a button named for it', async () => {
    const download = vi.fn(async () => null)
    show(view({ recording: { state: 'ready' } }), { engine: fakeEngine({ download }) })
    await openControl('Download Jam recording').click()
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('shows a named status while a download is in flight', async () => {
    let release: (blob: Blob | null) => void = () => {}
    const download = vi.fn(() => new Promise<Blob | null>((resolve) => (release = resolve)))
    show(view({ recording: { state: 'ready' } }), { engine: fakeEngine({ download }) })
    await openControl('Download Jam recording').click()
    await expect
      .element(page.getByRole('status', { name: 'Downloading Jam recording' }))
      .toBeVisible()
    release(new Blob(['x']))
  })

  it('shows a durable downloading status straight from the file state, with no click', async () => {
    show(
      view({
        recording: { state: 'ready' },
        file: recordingFile('r1', { local_state: 'downloading' }),
      }),
    )
    await expect
      .element(page.getByRole('status', { name: 'Downloading Jam recording' }))
      .toBeVisible()
  })

  it('ignores a stale downloading file state once the server has failed the recording', async () => {
    const { onRetry } = show(
      view({
        recording: { state: 'failed' },
        file: recordingFile('r1', { local_state: 'downloading' }),
      }),
    )
    expect(page.getByRole('status').query()).toBeNull()
    await page.getByRole('button', { name: 'Retry Jam recording' }).click()
    expect(onRetry).toHaveBeenCalledWith('transcode')
  })

  it("says Couldn't download once a download resolves nothing", async () => {
    const download = vi.fn(async () => null)
    show(view({ recording: { state: 'ready' } }), { engine: fakeEngine({ download }) })
    await openControl('Download Jam recording').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(DOWNLOAD_FAILED)
    // The row still offers another attempt once the failed one has settled.
    const named = openControl('Download Jam recording')
    await expect.element(named).toBeVisible()
    // The alert sits beside the open control's name, not inside it.
    expect(
      page.getByRole('button', { name: "Download Jam recording Couldn't download" }).query(),
    ).toBeNull()
  })

  it('lets a caller-supplied error take priority over a download failure', async () => {
    const download = vi.fn(async () => null)
    show(view({ recording: { state: 'ready' } }), {
      engine: fakeEngine({ download }),
      error: 'Something else',
    })
    await openControl('Download Jam recording').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Something else')
  })

  it('offers an upload retry for a stuck upload', async () => {
    const { onRetry } = show(view({ file: recordingFile('r1', { local_state: 'failed_upload' }) }))
    const retry = page.getByRole('button', { name: 'Retry uploading Jam recording' })
    await retry.click()
    expect(onRetry).toHaveBeenCalledWith('upload')
    // The shadow button getByRole finds sits inside the ion-button host.
    expect((retry.element().getRootNode() as ShadowRoot).host.tagName.toLowerCase()).toBe(
      'ion-button',
    )
  })

  it('gives Retry a tap target of its own, on a mouse', async () => {
    show(view({ file: recordingFile('r1', { local_state: 'failed_upload' }) }))
    const retry = page.getByRole('button', { name: 'Retry uploading Jam recording' })
    await expect.element(retry).toBeVisible()
    const box = (retry.element().getRootNode() as ShadowRoot).host.getBoundingClientRect()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  })

  it('gives Retry a tap target of its own, on touch', async () => {
    forceTouch()
    show(view({ file: recordingFile('r1', { local_state: 'failed_upload' }) }))
    const retry = page.getByRole('button', { name: 'Retry uploading Jam recording' })
    await expect.element(retry).toBeVisible()
    const box = (retry.element().getRootNode() as ShadowRoot).host.getBoundingClientRect()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  })

  it('offers a transcode retry for a server failure', async () => {
    const { onRetry } = show(view({ recording: { state: 'failed' } }))
    const retry = page.getByRole('button', { name: 'Retry Jam recording' })
    await retry.click()
    expect(onRetry).toHaveBeenCalledWith('transcode')
    expect((retry.element().getRootNode() as ShadowRoot).host.tagName.toLowerCase()).toBe(
      'ion-button',
    )
  })

  it('shows Offline in the meta line and refuses the download tap, on a mouse', async () => {
    const download = vi.fn(async () => null)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    show(view({ recording: { state: 'ready' } }), { engine: fakeEngine({ download }) })
    // Ionic never carries aria-disabled from ion-item's host to its native button, so the row
    // says why in the meta line, the one place every pointer reads a state word.
    const button = openControl('Download')
    await expect.element(button).toBeVisible()
    await expect.element(page.getByText('Offline', { exact: true })).toBeVisible()
    await button.click()
    expect(download).not.toHaveBeenCalled()
  })

  it('shows Offline in the meta line and refuses the download tap, on touch', async () => {
    forceTouch()
    const download = vi.fn(async () => null)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    show(view({ recording: { state: 'ready' } }), { engine: fakeEngine({ download }) })
    const button = openControl('Download')
    await expect.element(button).toBeVisible()
    await expect.element(page.getByText('Offline', { exact: true })).toBeVisible()
    await button.click()
    expect(download).not.toHaveBeenCalled()
  })

  it('shows the error prop under the meta line as an alert', async () => {
    show(view(), { error: 'Refused' })
    await expect.element(page.getByRole('alert')).toHaveTextContent('Refused')
  })

  it('gives the meta line tabular numerals', async () => {
    show(view({ recording: { duration_ms: 42_000, state: 'ready' } }))
    const meta = document.querySelector('p.type-subheadline')
    expect(meta).not.toBeNull()
    expect(meta!.classList.contains('tabular-nums')).toBe(true)
  })

  it('adds the storage label once a blocked upload has storage figures to show', async () => {
    const db = openTestDb()
    await setStorage(db, { used_bytes: 1_000_000, quota_bytes: 2_000_000, max_file_bytes: 500_000 })
    show(view({ file: recordingFile('r1', { local_state: 'blocked_quota' }) }), { db })
    await expect.element(page.getByText('1 MB of 2 MB used', { exact: false })).toBeVisible()
  })

  it('shows the actions passed in with the names Row gives them', async () => {
    const actions: RowAction[] = [
      { label: 'Rename', icon: Pencil, tone: 'neutral', onPress: vi.fn() },
    ]
    show(view(), { actions })
    await expect.element(page.getByRole('button', { name: 'Rename Jam recording' })).toBeVisible()
  })

  it('still reveals swipe actions on touch once the open control has its own button', async () => {
    forceTouch()
    const onPress = vi.fn()
    const actions: RowAction[] = [{ label: 'Rename', icon: Pencil, tone: 'neutral', onPress }]
    show(view({ recording: { state: 'ready' } }), { actions })
    const sliding = document.querySelector<HTMLIonItemSlidingElement>('ion-item-sliding')!
    await vi.waitFor(async () => {
      await sliding.open('end')
      expect(sliding.classList.contains('item-sliding-active-slide')).toBe(true)
    })
    const rename = page.getByRole('button', { name: 'Rename Jam recording' })
    await expect.element(rename).toBeVisible()
    await rename.click()
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('keeps play and Retry as two separate controls for a held recording with a stuck upload, on touch', async () => {
    forceTouch()
    const player = fakePlayer()
    const { onRetry } = show(
      view({ file: recordingFile('r1', { blob: new Blob(['x']), local_state: 'failed_upload' }) }),
      { player },
    )
    const playButton = openControl('Play Jam recording')
    const retry = page.getByRole('button', { name: 'Retry uploading Jam recording' })
    await expect.element(playButton).toBeVisible()
    await expect.element(retry).toBeVisible()
    // Retry's own name never widens into the play control's name.
    expect(
      page
        .getByRole('button', { name: 'Play Jam recording Retry uploading Jam recording' })
        .query(),
    ).toBeNull()
    await retry.click()
    expect(onRetry).toHaveBeenCalledWith('upload')
    expect(player.play).not.toHaveBeenCalled()
    await playButton.click()
    expect(player.play).toHaveBeenCalledWith({ kind: 'recording', id: 'r1' })
  })
})
