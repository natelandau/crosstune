import { IonButton, IonContent, IonPage, useIonRouter } from '@ionic/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createSong } from '../../commands/songs'
import { openTestDb } from '../../test/db'
import { fakeStream, FakeRecorder, stubMediaGlobals } from '../../test/fakeMedia'
import { renderIonic, renderScreen } from '../../test/ionic'
import type * as ToastModule from '../../ui/Toast'
import { RecordProvider, useRecord } from './useRecord'

let toasts: string[] = []
vi.mock('../../ui/Toast', async (importOriginal) => {
  const actual = await importOriginal<typeof ToastModule>()
  return {
    ...actual,
    useToast: () => {
      const toast = actual.useToast()
      return (options: Parameters<typeof toast>[0]) => {
        toasts.push(options.message)
        toast(options)
      }
    },
  }
})

type Start = (songId?: string) => void

function Host({ songId, onReady }: { songId?: string; onReady?: (start: Start) => void }) {
  const { start } = useRecord()
  // Hands the seam's start out, so a test can ask for another recording without reaching
  // through the open modal to a control it covers.
  useEffect(() => {
    onReady?.(start)
  }, [onReady, start])
  return (
    <IonButton aria-label="Start a new recording" onClick={() => start(songId)}>
      Record
    </IonButton>
  )
}

type Router = ReturnType<typeof useIonRouter>

/** Hands the stack out, so a test can ask whether anything was pushed onto it. */
function RouterProbe({ onReady }: { onReady: (router: Router) => void }) {
  const router = useIonRouter()
  useEffect(() => {
    onReady(router)
  }, [onReady, router])
  return null
}

const shown = () => document.querySelector('ion-modal:not(.overlay-hidden)') !== null

let restore: (() => void) | null = null

/** Every browser global a recording touches, faked; the afterEach below puts each one back. */
function fakeMedia({ deny = false } = {}) {
  const owned = (['mediaDevices', 'storage'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
  )
  const { track, getUserMedia } = stubMediaGlobals()
  if (deny)
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  restore = () => {
    for (const [key, descriptor] of owned) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor)
      else Reflect.deleteProperty(navigator, key)
    }
  }
  return {
    getUserMedia,
    stream: () => fakeStream(track),
    muteTrack: () => track.dispatchEvent(new Event('mute')),
    unmuteTrack: () => track.dispatchEvent(new Event('unmute')),
  }
}

beforeEach(() => {
  toasts = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  restore?.()
  restore = null
})

describe('RecordModal', () => {
  it('opens from the seam and names itself', async () => {
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByText('New recording')).toBeVisible()
    await expect.element(page.getByRole('dialog', { name: 'New recording' })).toBeInTheDocument()
  })

  it('closes the player before it opens', async () => {
    // The player and the microphone must not run together.
    fakeMedia()
    const close = vi.fn()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      {
        db: openTestDb(),
        player: {
          item: { kind: 'recording', id: 'r1' },
          play: () => {},
          close,
          returnFocus: () => {},
        },
      },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    expect(close).toHaveBeenCalledOnce()
  })

  it('stays closed until asked, and closes again from its footer', async () => {
    fakeMedia({ deny: true })
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    // Ionic hydrates asynchronously, so the modal only carries its hidden class once it has.
    const record = page.getByRole('button', { name: 'Start a new recording' })
    await expect.element(record).toBeVisible()
    expect(shown()).toBe(false)
    await record.click()
    await expect.element(page.getByText('New recording')).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await vi.waitFor(() => expect(shown()).toBe(false))
  })

  it('leaves the microphone alone until it is opened', async () => {
    const media = fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    const record = page.getByRole('button', { name: 'Start a new recording' })
    await expect.element(record).toBeVisible()
    expect(media.getUserMedia).not.toHaveBeenCalled()

    await record.click()
    await vi.waitFor(() => expect(media.getUserMedia).toHaveBeenCalledOnce())
  })
})

describe('RecordModal capture', () => {
  it('holds its words inside the modal rather than against its edges', async () => {
    const media = fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    media.muteTrack()
    const banner = page.getByText('Recording interrupted.', { exact: false })
    await expect.element(banner).toBeVisible()
    const line = banner.element().getBoundingClientRect()
    const modal = document.querySelector('ion-modal')!.getBoundingClientRect()
    expect(line.left - modal.left).toBeGreaterThanOrEqual(12)
    expect(modal.right - line.right).toBeGreaterThanOrEqual(12)
    media.unmuteTrack()
  })

  it('shows the phase, the waveform, and the elapsed time while recording', async () => {
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    await expect.element(page.getByRole('timer')).toHaveTextContent('0:00')
    expect(document.querySelector('ion-modal canvas')).not.toBeNull()
  })

  it('draws the waveform in the palette rather than in the body text color', async () => {
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    const canvas = document.querySelector('ion-modal canvas')!
    // A probe beside the canvas resolves the palette color, so the palette itself can change.
    const probe = document.createElement('span')
    probe.style.color = 'var(--ion-color-primary)'
    canvas.parentElement!.append(probe)
    try {
      expect(getComputedStyle(canvas).color).toBe(getComputedStyle(probe).color)
      expect(getComputedStyle(canvas).color).not.toBe(getComputedStyle(canvas.parentElement!).color)
    } finally {
      probe.remove()
    }
  })

  it('stops, saves, and closes, landing on the song it was started for', async () => {
    const db = openTestDb()
    const { songId } = await createSong(db, { title: "Soldier's Joy" }, { status: 'known' })
    fakeMedia()
    renderScreen(
      <IonPage>
        <IonContent>
          <RecordProvider>
            <Host songId={songId} />
          </RecordProvider>
        </IonContent>
      </IonPage>,
      {
        db,
        path: '/recordings',
        route: '/recordings',
        probes: { '/catalog/:songId': 'Song probe' },
      },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await page.getByRole('button', { name: 'Stop' }).click()
    await vi.waitFor(async () => expect(await db.recordings.count()).toBe(1))
    await expect.element(page.getByRole('heading', { name: 'Song probe' })).toBeVisible()
    await vi.waitFor(() => expect(shown()).toBe(false))
  })

  it('lands on the song it was started from without opening a second copy of it', async () => {
    const db = openTestDb()
    const { songId } = await createSong(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    fakeMedia()
    let router: Router | null = null
    const holdRouter = (found: Router) => {
      router = found
    }
    renderScreen(
      <IonPage>
        <IonContent>
          <RouterProbe onReady={holdRouter} />
          <RecordProvider>
            <Host songId={songId} />
          </RecordProvider>
        </IonContent>
      </IonPage>,
      { db, path: `/catalog/${songId}`, route: '/catalog/:songId' },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await page.getByRole('button', { name: 'Stop' }).click()
    await vi.waitFor(async () => expect(await db.recordings.count()).toBe(1))
    await vi.waitFor(() => expect(shown()).toBe(false))
    expect(router!.canGoBack()).toBe(false)
  })

  it('says once that part of the recording could not be saved', async () => {
    const db = openTestDb()
    const { songId } = await createSong(db, { title: 'Sandy River Belle' }, { status: 'known' })
    fakeMedia()
    renderScreen(
      <IonPage>
        <IonContent>
          <RecordProvider>
            <Host songId={songId} />
          </RecordProvider>
        </IonContent>
      </IonPage>,
      {
        db,
        path: '/recordings',
        route: '/recordings',
        probes: { '/catalog/:songId': 'Song probe' },
      },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    vi.spyOn(db.recording_chunks, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'))
    await page.getByRole('button', { name: 'Stop' }).click()
    await vi.waitFor(async () => expect(await db.recordings.count()).toBe(1))
    // The landing pushes a route, which re-memoizes the router the saved handler reads.
    await expect.element(page.getByRole('heading', { name: 'Song probe' })).toBeVisible()
    await vi.waitFor(() => expect(shown()).toBe(false))
    expect(toasts).toEqual(['Part of this recording could not be saved.'])
  })

  it('asks before discarding once recording has started, and keeps the recording when it is refused', async () => {
    const db = openTestDb()
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(page.getByText('Discard this recording?')).toBeVisible()
    // Both the confirmation and the modal's footer offer a Cancel, so this one is the alert's.
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    // The alert removes itself as it dismisses; the next tap must not land on its backdrop.
    await vi.waitFor(() => expect(document.querySelector('ion-alert')).toBeNull())
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await vi.waitFor(() => expect(shown()).toBe(false))
    expect(await db.recordings.count()).toBe(0)
  })

  it('discards without asking while the microphone is still starting', async () => {
    const db = openTestDb()
    const media = fakeMedia()
    let grant = () => {}
    media.getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = () => resolve(media.stream())
        }),
    )
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Starting the microphone')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await vi.waitFor(() => expect(shown()).toBe(false))
    expect(document.querySelector('ion-alert')).toBeNull()
    grant()
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(0))
    expect(await db.recording_files.count()).toBe(0)
  })

  it('keeps Cancel big enough to tap while the recording runs', async () => {
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
    await expect.element(cancel).toBeVisible()
    expect(
      (cancel.element().getRootNode() as ShadowRoot).host.getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44)
  })

  it('says the microphone was refused and offers a way out', async () => {
    fakeMedia({ deny: true })
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Not recording')
    // The interruption banner carries role="alert" too, so the query names its line instead.
    await expect
      .element(page.getByText('Crosstune needs microphone access.', { exact: false }))
      .toHaveAttribute('role', 'alert')
    const done = page.getByRole('button', { name: 'Done', exact: true })
    await expect.element(done).toBeVisible()
    expect(
      (done.element().getRootNode() as ShadowRoot).host.getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44)
    await done.click()
    await vi.waitFor(() => expect(shown()).toBe(false))
  })

  it('keeps the timer on screen through an interruption', async () => {
    const media = fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    media.muteTrack()
    await expect.element(page.getByRole('status')).toHaveTextContent('Interrupted')
    // An error line carries role="alert" too, so the query names the banner's own words.
    await expect
      .element(page.getByText('Recording interrupted.', { exact: false }))
      .toHaveAttribute('role', 'alert')
    await expect.element(page.getByRole('timer')).toBeVisible()
    media.unmuteTrack()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
  })

  it('keeps a live recording when the modal is dismissed', async () => {
    const db = openTestDb()
    fakeMedia()
    const { unmount } = renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    unmount()
    await vi.waitFor(async () => expect(await db.recordings.count()).toBe(1))
  })

  it('refuses a swipe dismissal while the recording is live', async () => {
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    const modal = document.querySelector('ion-modal') as HTMLIonModalElement
    const canDismiss = modal.canDismiss as (data?: unknown, role?: string) => Promise<boolean>
    expect(await canDismiss(undefined, 'gesture')).toBe(false)
    expect(await canDismiss(undefined, undefined)).toBe(true)
  })

  it('ignores a second start for another song while a recording is already live', async () => {
    const db = openTestDb()
    const { songId } = await createSong(db, { title: 'Ragtime Annie' }, { status: 'known' })
    const media = fakeMedia()
    let again: Start = () => {}
    renderIonic(
      <RecordProvider>
        <Host
          onReady={(start) => {
            again = start
          }}
        />
      </RecordProvider>,
      { db },
    )
    await page.getByRole('button', { name: 'Start a new recording' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    // Another song would hand the capture a new song id, tearing the live session down.
    again(songId)
    // A restart asks for the microphone again, a few milliseconds behind the render that
    // would cause it, so this waits long enough for a second request to show up.
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    expect(media.getUserMedia).toHaveBeenCalledOnce()
    expect(FakeRecorder.instances).toHaveLength(1)
    expect(await db.recordings.count()).toBe(0)
  })

  it('keeps the recording and reopens after Escape dismisses it', async () => {
    const db = openTestDb()
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db },
    )
    const record = page.getByRole('button', { name: 'Start a new recording' })
    await record.click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(shown()).toBe(false))
    await vi.waitFor(async () => expect(await db.recordings.count()).toBe(1))
    await record.click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
  })

  it('keeps the recording and reopens after a backdrop dismissal', async () => {
    const db = openTestDb()
    fakeMedia()
    renderIonic(
      <RecordProvider>
        <Host />
      </RecordProvider>,
      { db },
    )
    const record = page.getByRole('button', { name: 'Start a new recording' })
    await record.click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
    await document.querySelector('ion-modal')!.dismiss(undefined, 'backdrop')
    await vi.waitFor(() => expect(shown()).toBe(false))
    await vi.waitFor(async () => expect(await db.recordings.count()).toBe(1))
    await record.click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Recording')
  })
})
