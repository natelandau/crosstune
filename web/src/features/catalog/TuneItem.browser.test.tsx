import { IonList } from '@ionic/react'
import { SquarePen } from 'lucide-react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { Instrument } from '../../api/vocabulary'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { tuneRow, userTuneRow } from '../../test/rows'
import { TuneItem } from './TuneItem'

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

const played = new Set<Instrument>(['violin', 'five_string_banjo'])

function show(
  tune = tuneRow('s1', "Soldier's Joy", {
    key: 'D',
    tunings: {
      violin: { tuning: 'Cross A (AEAE)' },
      five_string_banjo: { tuning: 'Double C (gCGCD)' },
    },
  }),
  userTune = userTuneRow('u1', 's1', { status: 'known' }),
  instruments = played,
) {
  renderIonic(
    <IonList>
      <TuneItem entry={{ tune, userTune }} instruments={instruments} onOpen={() => {}} />
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
        <TuneItem
          entry={{ tune: tuneRow('s1', "Soldier's Joy"), userTune: userTuneRow('u1', 's1') }}
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

describe('TuneItem', () => {
  it('puts the title alone on the first line in the headline role', async () => {
    show()
    const title = page.getByRole('heading', { name: "Soldier's Joy" })
    await expect.element(title).toBeVisible()
    expect(title.element().classList.contains('type-headline')).toBe(true)
  })

  it('ends a title too long for the row with an ellipsis inside the row', async () => {
    show(tuneRow('s1', 'Bonaparte Crossing the Rhine and the Long Road Home to Kentucky'))
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
    const line = document.querySelector('[data-tune-meta]')!
    expect(line.textContent).toBe(
      // The sr-only span speaks the full key ("Key D") and the aria-hidden pill still shows in
      // raw textContent, so the key's own text appears twice; a screen reader only hears the
      // sr-only span, and a sighted reader only sees the pill.
      'Key DD, Known, Violin: Cross A (AEAE) · 5-string banjo: Double C (gCGCD)',
    )
  })

  it('leaves the instrument unsaid when only one is played', async () => {
    show(undefined, undefined, new Set<Instrument>(['violin']))
    const line = document.querySelector('[data-tune-meta]')!
    expect(line.textContent).toBe('Key DD, Known, Cross A (AEAE)')
  })

  it('leaves a standard tuning unsaid and shows a capo', async () => {
    show(
      tuneRow('s1', "Soldier's Joy", {
        key: 'D',
        tunings: {
          violin: { tuning: 'Standard (GDAE)' },
          five_string_banjo: { tuning: 'Open G (gDGBD)', capo: 2 },
        },
      }),
    )
    const line = document.querySelector('[data-tune-meta]')!
    expect(line.textContent).toBe('Key DD, Known, 5-string banjo: Open G (gDGBD), capo 2')
  })

  it('shows a capo with no tuning', async () => {
    show(
      tuneRow('s1', 'Capo tune', { tunings: { guitar: { capo: 3 } } }),
      userTuneRow('u1', 's1', { status: 'known' }),
      new Set<Instrument>(['guitar']),
    )
    const line = document.querySelector('[data-tune-meta]')!
    expect(line.textContent).toBe('Known, Capo 3')
  })

  it('shows the key with its first mode and reads the full name', async () => {
    show(tuneRow('s1', "Soldier's Joy", { key: 'E', modes: ['dorian', 'major'] }))
    const meta = document.querySelector('[data-tune-meta]')!
    expect(meta.querySelector('.key-pill')?.textContent).toBe('E dor')
    expect(meta.textContent).toContain('Key E dorian')
  })

  it('shows no mode for a tune with no key', async () => {
    show(tuneRow('s1', "Soldier's Joy", { key: null, modes: ['dorian'] }))
    expect(document.querySelector('[data-tune-meta]')!.textContent).not.toContain('dorian')
  })

  it('leaves out a missing key and a tuning for an instrument not played', async () => {
    show(
      tuneRow('s1', 'Cluck Old Hen', {
        tunings: { five_string_banjo: { tuning: 'Double C (gCGCD)' } },
      }),
      userTuneRow('u1', 's1', { status: 'learning' }),
      new Set<Instrument>(['violin']),
    )
    const line = document.querySelector('[data-tune-meta]')!
    expect(line.textContent).toBe('Learning')
  })

  it('marks an archived tune and dims its row', async () => {
    show(
      tuneRow('s1', 'Old'),
      userTuneRow('u1', 's1', { status: 'known', archived_at: '2026-01-01T00:00:00Z' }),
    )
    await expect.element(page.getByText('Archived')).toBeVisible()
    expect(document.querySelector('.opacity-60')).not.toBeNull()
    const line = document.querySelector('[data-tune-meta]')!
    expect(line.textContent).toBe('Known, Archived')
  })

  it('labels an unrecognized status as Unknown', async () => {
    show(tuneRow('s1', 'New'), userTuneRow('u1', 's1', { status: 'bogus' }))
    await expect.element(page.getByText('Unknown')).toBeVisible()
  })

  it('separates the parts of the row open control spoken name', async () => {
    show()
    const open = page.getByRole('button', {
      name: "Soldier's Joy Key D , Known , Violin: Cross A (AEAE) · 5-string banjo: Double C (gCGCD)",
      exact: true,
    })
    await expect.element(open).toBeVisible()
  })

  it('carries selection through to the row', async () => {
    renderIonic(
      <IonList>
        <TuneItem
          entry={{ tune: tuneRow('s1', "Soldier's Joy"), userTune: userTuneRow('u1', 's1') }}
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
        <TuneItem
          entry={{ tune: tuneRow('s1', "Soldier's Joy"), userTune: userTuneRow('u1', 's1') }}
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
