import { IonList } from '@ionic/react'
import { SquarePen } from 'lucide-react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { songRow, userSongRow } from '../../test/rows'
import { SongItem } from './SongItem'
import type { Instrument } from '../../constants'

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

const played = new Set<Instrument>(['violin', 'banjo'])

function show(
  song = songRow('s1', "Soldier's Joy", {
    key: 'D',
    violin_tuning: 'Standard (GDAE)',
    banjo_tuning: 'Open G (gDGBD)',
  }),
  userSong = userSongRow('u1', 's1', { status: 'known' }),
  instruments = played,
) {
  renderIonic(
    <IonList>
      <SongItem entry={{ song, userSong }} instruments={instruments} onOpen={() => {}} />
    </IonList>,
    { db: openTestDb() },
  )
}

/** One row carrying both swipe actions and a selection that can be switched on. */
function SelectableRow() {
  const [selecting, setSelecting] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setSelecting(true)}>
        Start selecting
      </button>
      <IonList>
        <SongItem
          entry={{ song: songRow('s1', "Soldier's Joy"), userSong: userSongRow('u1', 's1') }}
          instruments={played}
          onOpen={() => {}}
          actions={[{ label: 'Edit', icon: SquarePen, tone: 'neutral', onPress: () => {} }]}
          selection={
            selecting ? { selected: false, onToggle: () => {}, onLongPress: () => {} } : undefined
          }
        />
      </IonList>
    </>
  )
}

describe('SongItem', () => {
  it('puts the title alone on the first line in the headline role', async () => {
    show()
    const title = page.getByRole('heading', { name: "Soldier's Joy" })
    await expect.element(title).toBeVisible()
    expect(title.element().classList.contains('type-headline')).toBe(true)
  })

  it('ends a title too long for the row with an ellipsis inside the row', async () => {
    show(songRow('s1', 'Bonaparte Crossing the Rhine and the Long Road Home to Kentucky'))
    const title = page.getByRole('heading', { name: /^Bonaparte/ })
    await expect.element(title).toBeVisible()
    const heading = title.element() as HTMLElement
    // Ionic's label styles make a heading inherit its overflow from the label.
    await expect.poll(() => getComputedStyle(heading).overflow).toBe('hidden')
    expect(getComputedStyle(heading).textOverflow).toBe('ellipsis')
    expect(heading.scrollWidth).toBeGreaterThan(heading.clientWidth)
  })

  it('shows the key, the status with its label, and tunings for played instruments in order', async () => {
    show()
    const line = document.querySelector('[data-song-meta]')!
    expect(line.textContent).toBe('Key D, Known, Standard (GDAE) · Open G (gDGBD)')
  })

  it('leaves out a missing key and a tuning for an instrument not played', async () => {
    show(
      songRow('s1', 'Cluck Old Hen', { banjo_tuning: 'Open G (gDGBD)' }),
      userSongRow('u1', 's1', { status: 'learning' }),
      new Set<Instrument>(['violin']),
    )
    const line = document.querySelector('[data-song-meta]')!
    expect(line.textContent).toBe('Learning')
  })

  it('marks an archived song and dims its row', async () => {
    show(
      songRow('s1', 'Old'),
      userSongRow('u1', 's1', { status: 'known', archived_at: '2026-01-01T00:00:00Z' }),
    )
    await expect.element(page.getByText('Archived')).toBeVisible()
    expect(document.querySelector('.opacity-60')).not.toBeNull()
    const line = document.querySelector('[data-song-meta]')!
    expect(line.textContent).toBe('Known, Archived')
  })

  it('labels an unrecognized status as Unknown', async () => {
    show(songRow('s1', 'New'), userSongRow('u1', 's1', { status: 'bogus' }))
    await expect.element(page.getByText('Unknown')).toBeVisible()
  })

  it('separates the parts of the row open control spoken name', async () => {
    show()
    const open = page.getByRole('button', {
      name: "Soldier's Joy Key D , Known , Standard (GDAE) · Open G (gDGBD)",
      exact: true,
    })
    await expect.element(open).toBeVisible()
  })

  it('carries selection through to the row', async () => {
    renderIonic(
      <IonList>
        <SongItem
          entry={{ song: songRow('s1', "Soldier's Joy"), userSong: userSongRow('u1', 's1') }}
          instruments={played}
          onOpen={() => {}}
          selection={{ selected: true, onToggle: () => {}, onLongPress: () => {} }}
        />
      </IonList>,
      { db: openTestDb() },
    )
    await expect
      .element(page.getByRole('checkbox', { name: /^Deselect Soldier's Joy/ }))
      .toBeChecked()
    expect(document.querySelector('[data-row-check]')).not.toBeNull()
    expect(document.getElementById('select-u1')).toHaveAttribute('data-row-open')
  })

  it('takes the row actions away as soon as it is given a selection', async () => {
    renderIonic(<SelectableRow />, { db: openTestDb() })
    const edit = page.getByRole('button', { name: "Edit Soldier's Joy" })
    await expect.poll(() => edit.elements().length).toBe(1)
    await page.getByRole('button', { name: 'Start selecting' }).click()
    await expect
      .element(page.getByRole('checkbox', { name: /^Select Soldier's Joy/ }))
      .toBeVisible()
    expect(edit.elements()).toHaveLength(0)
  })

  it('carries a long press through to the row', async () => {
    forceTouch()
    const onLongPress = vi.fn()
    renderIonic(
      <IonList>
        <SongItem
          entry={{ song: songRow('s1', "Soldier's Joy"), userSong: userSongRow('u1', 's1') }}
          instruments={played}
          onOpen={() => {}}
          onLongPress={onLongPress}
        />
      </IonList>,
      { db: openTestDb() },
    )
    document.querySelector('ion-item')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      }),
    )
    await vi.waitFor(() => expect(onLongPress).toHaveBeenCalledOnce(), { timeout: 2000 })
  })
})
