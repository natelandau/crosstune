import { IonButton, IonInput, IonList, IonModal } from '@ionic/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { Instrument } from '../../api/vocabulary'
import type { CrosstuneDb } from '../../db/schema'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { tuneRow, userTuneRow } from '../../test/rows'
import { Screen } from '../../ui/Screen'
import { TuneItem } from '../catalog/TuneItem'
import { selectionCheckboxId } from './ids'
import { useSelection } from './useSelection'

const ENTRIES = [
  { tune: tuneRow('s1', 'Angeline the Baker'), userTune: userTuneRow('u1', 's1') },
  { tune: tuneRow('s2', 'Cluck Old Hen'), userTune: userTuneRow('u2', 's2') },
  { tune: tuneRow('s3', "Soldier's Joy"), userTune: userTuneRow('u3', 's3') },
]
const ALL_IDS: readonly string[] = ['u1', 'u2', 'u3']
const FIRST_TWO: readonly string[] = ['u1', 'u2']
const INSTRUMENTS: ReadonlySet<Instrument> = new Set<Instrument>(['violin'])
const HIDE_SELECT = 'harness-hide-select'

let db: CrosstuneDb
const originalMatchMedia = window.matchMedia

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

/**
 * A screen of three tune rows driven by the hook, with the controls a test needs to change what
 * is visible and to take the Select control away without stealing focus from it.
 */
function Harness({ onEnter }: { onEnter?: () => void }) {
  const [ids, setIds] = useState(ALL_IDS)
  const [showSelect, setShowSelect] = useState(true)
  const [sheet, setSheet] = useState(false)
  const { active, selection, selectRef, enter, exit, rowSelection, onClickCapture } = useSelection(
    ids,
    onEnter,
  )

  useEffect(() => {
    const hide = () => setShowSelect(false)
    window.addEventListener(HIDE_SELECT, hide)
    return () => window.removeEventListener(HIDE_SELECT, hide)
  }, [])

  return (
    <Screen
      title="Catalog"
      level="top"
      end={
        showSelect ? (
          <IonButton ref={selectRef} onClick={() => (active ? exit() : enter())}>
            {active ? 'Done' : 'Select'}
          </IonButton>
        ) : null
      }
    >
      <p data-probe={`${active}:${selection.count}:${selection.allSelected}`} className="sr-only">
        probe
      </p>
      <IonInput label="Notes" />
      <IonList onClickCapture={onClickCapture}>
        {ENTRIES.filter((entry) => ids.includes(entry.userTune.id)).map((entry) => {
          const row = rowSelection(entry.userTune.id)
          return (
            <TuneItem
              key={entry.userTune.id}
              entry={entry}
              instruments={INSTRUMENTS}
              onOpen={() => {}}
              selection={active ? row : undefined}
              onLongPress={row.onLongPress}
            />
          )
        })}
      </IonList>
      <IonButton onClick={() => selection.selectAll()}>Select all</IonButton>
      <IonButton onClick={() => selection.toggle('u2')}>Preselect second</IonButton>
      <IonButton onClick={() => setIds(FIRST_TWO)}>Narrow</IonButton>
      <IonButton onClick={() => setIds(ALL_IDS)}>Widen</IonButton>
      <IonButton onClick={() => setSheet(true)}>Open sheet</IonButton>
      <IonModal isOpen={sheet} onDidDismiss={() => setSheet(false)}>
        <p>Sheet body</p>
      </IonModal>
    </Screen>
  )
}

const show = (onEnter?: () => void) =>
  renderScreen(<Harness onEnter={onEnter} />, { db, path: '/catalog' })

// Ionic hydrates its components and runs its transitions asynchronously, so a settled state
// can take longer than vi.waitFor's own default allows on a loaded machine. Matches the
// asyncUtilTimeout the browser suite is configured with.
const SETTLE_MS = 3000

const settle = (check: () => void) => vi.waitFor(check, { timeout: SETTLE_MS })

const probe = () => document.querySelector('[data-probe]')!.getAttribute('data-probe')!.split(':')
const isActive = () => probe()[0] === 'true'
const count = () => Number(probe()[1])
const allSelected = () => probe()[2] === 'true'

const control = (name: string) => page.getByRole('button', { name })
const checkFor = (id: string) => document.getElementById(selectionCheckboxId(id))
const rowCheckbox = (name: RegExp) => page.getByRole('checkbox', { name })

/** The Select control, and the element inside it that actually takes focus. */
function selectControl() {
  const host = document.querySelector<HTMLElement>('ion-toolbar ion-button')!
  return { host, native: host.shadowRoot!.querySelector<HTMLElement>('button')! }
}

/**
 * Holds the row at `index` until the long press fires, then lifts. The hold blocks the click it
 * leaves behind for a moment after the release, so the lift has to happen before the next click.
 */
async function longPressRow(index: number) {
  const row = document.querySelectorAll('ion-item')[index]!
  row.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    }),
  )
  await settle(() => expect(isActive()).toBe(true))
  row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true }))
  await new Promise((resolve) => setTimeout(resolve, 100))
}

async function startSelecting() {
  await control('Select').click()
  await settle(() => expect(isActive()).toBe(true))
}

/** Presses the select-all chord and reports whether the hook claimed the keystroke. */
async function pressSelectAll(modifier: 'Meta' | 'Control'): Promise<boolean> {
  let prevented = false
  const watch = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'a') prevented = event.defaultPrevented
  }
  window.addEventListener('keydown', watch)
  try {
    await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`)
  } finally {
    window.removeEventListener('keydown', watch)
  }
  return prevented
}

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  window.matchMedia = originalMatchMedia
  vi.unstubAllGlobals()
  await db.delete()
})

describe('useSelection', () => {
  it('enters from the control and focuses the first row check mark', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await settle(() => expect(checkFor('u1')).not.toBeNull())
    expect(document.activeElement).toBe(checkFor('u1'))
    expect(document.activeElement).toHaveAttribute('data-row-open')
  })

  it('tells the caller it is entering, once per entry and never on leaving', async () => {
    const onEnter = vi.fn()
    show(onEnter)
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    expect(onEnter).toHaveBeenCalledOnce()
    await userEvent.keyboard('{Escape}')
    await settle(() => expect(isActive()).toBe(false))
    expect(onEnter).toHaveBeenCalledOnce()
    await startSelecting()
    expect(onEnter).toHaveBeenCalledTimes(2)
  })

  it('enters with a row selected when a long press names it', async () => {
    forceTouch()
    show()
    await expect.element(page.getByRole('heading', { name: 'Cluck Old Hen' })).toBeVisible()
    await longPressRow(1)
    await expect.element(rowCheckbox(/^Deselect Cluck Old Hen/)).toBeChecked()
    expect(count()).toBe(1)
    await settle(() => expect(document.activeElement).toBe(checkFor('u2')))
  })

  it('counts toggles and reports when all are selected', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Angeline the Baker/).click()
    await rowCheckbox(/^Select Cluck Old Hen/).click()
    await settle(() => expect(count()).toBe(2))
    expect(allSelected()).toBe(false)
    await control('Select all').click()
    await settle(() => expect(count()).toBe(3))
    expect(allSelected()).toBe(true)
  })

  it('extends a range with shift and never deselects', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Angeline the Baker/).click()
    await settle(() => expect(count()).toBe(1))
    await rowCheckbox(/^Select Soldier's Joy/).click({ modifiers: ['Shift'] })
    await settle(() => expect(count()).toBe(3))
    await rowCheckbox(/^Deselect Soldier's Joy/).click({ modifiers: ['Shift'] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(count()).toBe(3)
  })

  it('selects all with Meta-A while a check mark has focus', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await settle(() => expect(document.activeElement).toBe(checkFor('u1')))
    expect(await pressSelectAll('Meta')).toBe(true)
    await settle(() => expect(count()).toBe(3))
  })

  it('selects all with Control-A while a check mark has focus', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await settle(() => expect(document.activeElement).toBe(checkFor('u1')))
    expect(await pressSelectAll('Control')).toBe(true)
    await settle(() => expect(count()).toBe(3))
  })

  it('never deselects with the select-all chord', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await pressSelectAll('Meta')
    await settle(() => expect(count()).toBe(3))
    await pressSelectAll('Meta')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(count()).toBe(3)
  })

  it('ignores Meta-A while focus is in a text field', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await page.getByLabelText('Notes').click()
    expect(await pressSelectAll('Meta')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(count()).toBe(0)
    expect(isActive()).toBe(true)
  })

  it('leaves on Escape', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await userEvent.keyboard('{Escape}')
    await settle(() => expect(isActive()).toBe(false))
  })

  it('takes no keystroke on touch, which never shows a Select control', async () => {
    forceTouch()
    show()
    await expect.element(page.getByRole('heading', { name: 'Cluck Old Hen' })).toBeVisible()
    await longPressRow(1)
    await userEvent.keyboard('{Escape}')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(isActive()).toBe(true)
  })

  it('keeps the mode when Escape fires with an overlay open', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await control('Open sheet').click()
    await settle(() =>
      expect(document.querySelector('ion-modal:not(.overlay-hidden)')).not.toBeNull(),
    )
    await userEvent.keyboard('{Escape}')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(isActive()).toBe(true)
  })

  it('leaves on the hardware back button without popping the page', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    expect(registerBack().find((entry) => entry.priority === 50)).toBeUndefined()
    await startSelecting()
    const mine = registerBack().find((entry) => entry.priority === 50)
    expect(mine).toBeDefined()
    const next = vi.fn()
    mine!.handler(next)
    await settle(() => expect(isActive()).toBe(false))
    expect(next).not.toHaveBeenCalled()
    expect(registerBack().find((entry) => entry.priority === 50)).toBeUndefined()
  })

  it('drops a tune the visible set no longer holds', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await control('Select all').click()
    await settle(() => expect(count()).toBe(3))
    await control('Narrow').click()
    await settle(() => expect(count()).toBe(2))
  })

  it('does not bring a tune back when it becomes visible again', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await control('Select all').click()
    await settle(() => expect(count()).toBe(3))
    await control('Narrow').click()
    await settle(() => expect(count()).toBe(2))
    await control('Widen').click()
    await expect.element(rowCheckbox(/^Select Soldier's Joy/)).not.toBeChecked()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(count()).toBe(2)
    await expect.element(rowCheckbox(/^Deselect Angeline the Baker/)).toBeChecked()
  })

  it('clears the selection on leaving', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Cluck Old Hen/).click()
    await settle(() => expect(count()).toBe(1))
    await userEvent.keyboard('{Escape}')
    await settle(() => expect(isActive()).toBe(false))
    await startSelecting()
    expect(count()).toBe(0)
  })

  it('keeps a selection made before the mode opens', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await control('Preselect second').click()
    await settle(() => expect(count()).toBe(1))
    await startSelecting()
    await expect.element(rowCheckbox(/^Deselect Cluck Old Hen/)).toBeChecked()
    expect(count()).toBe(1)
  })

  it('returns focus to the Select control on leaving', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    await userEvent.keyboard('{Escape}')
    await settle(() => expect(isActive()).toBe(false))
    const { host, native } = selectControl()
    await settle(() => expect(document.activeElement).toBe(host))
    expect(host.shadowRoot!.activeElement).toBe(native)
  })

  it('moves focus to the page when the Select control is gone on leaving', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    window.dispatchEvent(new Event(HIDE_SELECT))
    await settle(() => expect(document.querySelector('ion-toolbar ion-button')).toBeNull())
    await userEvent.keyboard('{Escape}')
    await settle(() => expect(isActive()).toBe(false))
    const landmark = document.querySelector<HTMLElement>('main')!
    await settle(() => expect(document.activeElement).toBe(landmark))
  })

  it('moves focus to the page when the focused Select control unmounts', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    const { native } = selectControl()
    native.focus()
    await settle(() => expect(document.activeElement).toBe(selectControl().host))
    window.dispatchEvent(new Event(HIDE_SELECT))
    await settle(() => expect(document.querySelector('ion-toolbar ion-button')).toBeNull())
    expect(document.activeElement).toBe(document.querySelector('main'))
  })

  it('leaves the mode when the view goes away', async () => {
    show()
    await expect.element(control('Select')).toBeVisible()
    await startSelecting()
    // ion-app carries the ion-page class too, so the screen's own page is the div.
    const screenPage = document.querySelector('div.ion-page')!
    screenPage.dispatchEvent(new CustomEvent('ionViewWillLeave'))
    await settle(() => expect(isActive()).toBe(false))
  })
})

interface BackRegistration {
  priority: number
  handler: (next?: () => void) => void
}

/** Fires Ionic's back-button event and collects everything that asked for a turn. */
function registerBack(): BackRegistration[] {
  const registered: BackRegistration[] = []
  document.dispatchEvent(
    new CustomEvent('ionBackButton', {
      bubbles: true,
      detail: {
        register: (priority: number, handler: (next?: () => void) => void) =>
          registered.push({ priority, handler }),
      },
    }),
  )
  return registered
}
