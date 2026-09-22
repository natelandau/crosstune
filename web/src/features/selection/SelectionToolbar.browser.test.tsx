import { IonButton } from '@ionic/react'
import { screen } from '@testing-library/react'
import { ListPlus, SquarePen, Tag } from 'lucide-react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { MORE_ACTIONS, type MenuItem } from '../../ui/Menu'
import { Screen } from '../../ui/Screen'
import { ADD_TO_LIST } from '../lists/ListPicker'
import { SelectionFooter } from './SelectionFooter'
import { SelectionProvider, useSelectionChrome } from './SelectionProvider'
import {
  CANCEL_SELECTION,
  DESELECT_ALL,
  SELECT_ALL,
  useSelectionToolbar,
  type BulkAction,
} from './SelectionToolbar'
import type { SongSelection } from './useSongSelection'

let db: CrosstuneDb

const onExit = vi.fn()
const onStatus = vi.fn()
const toggleAll = vi.fn()
const onArchive = vi.fn()

const ACTIONS: readonly BulkAction[] = [
  { label: 'Status', icon: Tag, onPress: onStatus },
  { label: 'Edit', icon: SquarePen, onPress: () => {} },
  { label: ADD_TO_LIST, icon: ListPlus, onPress: () => {} },
]
const MORE: readonly MenuItem[] = [{ label: 'Archive 2 songs', onPress: onArchive }]
const NAMES = ['Status', 'Edit', ADD_TO_LIST, MORE_ACTIONS]

/** Reports the flag the footer publishes, which on md nothing may raise. */
function ChromeProbe() {
  const { selecting } = useSelectionChrome()
  return <p data-selecting={selecting} className="sr-only" />
}

function Harness({ count, level = 'top' }: { count: number; level?: 'top' | 'pushed' }) {
  const [all, setAll] = useState(false)
  const selection: SongSelection = {
    count: all ? 3 : count,
    allSelected: all,
    isSelected: () => false,
    toggle: () => {},
    toggleRange: () => {},
    selectAll: () => {},
    clear: () => {},
    toggleAll: () => {
      toggleAll()
      setAll((current) => !current)
    },
  }
  const toolbar = useSelectionToolbar({ selection, actions: ACTIONS, more: MORE, onExit })
  return (
    <SelectionProvider>
      <Screen
        title={toolbar.title}
        titleClass={toolbar.titleClass}
        level={level}
        backHref="/lists"
        selecting
        start={toolbar.start}
        end={toolbar.end}
        footer={<SelectionFooter selection={selection} actions={ACTIONS} more={MORE} />}
      >
        <ChromeProbe />
        <IonButton onClick={() => setAll(true)}>Select everything</IonButton>
        <p>Body</p>
      </Screen>
    </SelectionProvider>
  )
}

const show = (count: number, level?: 'top' | 'pushed') =>
  renderScreen(<Harness count={count} level={level} />, { db, path: '/catalog' })

/** The element the title's text is laid out in, inside ion-title's shadow root. */
const titleBox = () =>
  document.querySelector('ion-header ion-title')!.shadowRoot!.querySelector('.toolbar-title')!

const control = (name: string) => page.getByRole('button', { name })
const selecting = () => document.querySelector('[data-selecting]')!.getAttribute('data-selecting')

/** An ion-button keeps its native button in a shadow root, which `closest` never leaves. */
function host(name: string): HTMLElement {
  const root = control(name).element().getRootNode()
  return (root as ShadowRoot).host as HTMLElement
}

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('useSelectionToolbar on md', () => {
  it('reads the count in the title', async () => {
    show(2)
    await expect.element(page.getByText('2 selected').first()).toBeVisible()
  })

  it('cancels from the leading control', async () => {
    show(2)
    await expect.element(control(CANCEL_SELECTION)).toBeVisible()
    await control(CANCEL_SELECTION).click()
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('shows an icon button per action, each named', async () => {
    show(2)
    for (const name of NAMES) {
      await expect.element(control(name)).toBeVisible()
      expect(host(name).querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      expect(host(name).textContent).toBe('')
    }
    await control('Status').click()
    expect(onStatus).toHaveBeenCalledOnce()
  })

  it('dims every action at zero selected and keeps the overflow live', async () => {
    show(0)
    for (const name of ['Status', 'Edit', ADD_TO_LIST]) {
      await expect.element(control(name)).toBeVisible()
      await expect.element(control(name)).toBeDisabled()
    }
    await expect.element(control(MORE_ACTIONS)).toBeVisible()
    await expect.element(control(MORE_ACTIONS)).not.toBeDisabled()
  })

  it('reaches Select all at zero selected, where the mode opens', async () => {
    show(0)
    await expect.element(control(MORE_ACTIONS)).toBeVisible()
    await control(MORE_ACTIONS).click()
    await expect.element(await screen.findByText(SELECT_ALL)).toBeVisible()
    await screen.getByText(SELECT_ALL).click()
    expect(toggleAll).toHaveBeenCalledOnce()
    await expect.element(page.getByText('3 selected').first()).toBeVisible()
  })

  it('gives every control a 44px tap target', async () => {
    show(2)
    await expect.element(control(CANCEL_SELECTION)).toBeVisible()
    for (const name of [CANCEL_SELECTION, ...NAMES]) {
      const box = host(name).getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  })

  it('puts Select all in the More menu', async () => {
    show(2)
    await expect.element(control(MORE_ACTIONS)).toBeVisible()
    await control(MORE_ACTIONS).click()
    await expect.element(await screen.findByText(SELECT_ALL)).toBeVisible()
    await expect.element(await screen.findByText('Archive 2 songs')).toBeVisible()
    await screen.getByText(SELECT_ALL).click()
    expect(toggleAll).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(screen.queryByText(SELECT_ALL)).not.toBeInTheDocument(), {
      timeout: 3000,
    })
    await control(MORE_ACTIONS).click()
    await expect.element(await screen.findByText(DESELECT_ALL)).toBeVisible()
    expect(screen.queryByText(SELECT_ALL)).not.toBeInTheDocument()
  })

  it('announces the count in a live region of its own', async () => {
    show(2)
    await expect.element(control('Select everything')).toBeVisible()
    const region = document.querySelector('p[aria-live="polite"]')!
    expect(region.className).toContain('sr-only')
    expect(region.textContent).toBe('2 selected')
    const before = region.firstElementChild
    await control('Select everything').click()
    await vi.waitFor(() => expect(region.textContent).toBe('3 selected'), { timeout: 3000 })
    // A reader announces text that arrives in a region already there, not a region replaced.
    expect(region.isConnected).toBe(true)
    expect(region.firstElementChild).not.toBe(before)
  })

  it('sets the count in tabular numerals', async () => {
    show(2)
    await expect.element(page.getByText('2 selected').first()).toBeVisible()
    const title = document.querySelector('ion-toolbar ion-title')!
    expect(getComputedStyle(title).fontVariantNumeric).toBe('tabular-nums')
    const announced = document.querySelector('p[aria-live="polite"] span')!
    expect(getComputedStyle(announced).fontVariantNumeric).toBe('tabular-nums')
  })

  it.each([
    ['top', 13],
    ['pushed', 13],
    ['top', 130],
    ['pushed', 130],
  ] as const)(
    'keeps every digit of a count beside its controls at 320px on a %s screen',
    async (level, count) => {
      await page.viewport(320, 640)
      try {
        show(count, level)
        await expect.element(control(MORE_ACTIONS)).toBeVisible()
        // The bar cannot hold the whole label at this width in either text size, and the word is
        // what it is allowed to give up: a count elided to its first digits reads as a smaller
        // number rather than as a truncation.
        for (const size of ['regular', 'roomy'] as const) {
          if (size === 'roomy') document.documentElement.dataset.textSize = 'roomy'
          const digits = document.querySelector('.selection-title-count')!
          expect(digits.scrollWidth, size).toBeLessThanOrEqual(digits.clientWidth)
          expect(digits.getBoundingClientRect().right, size).toBeLessThanOrEqual(
            titleBox().getBoundingClientRect().right + 0.5,
          )
          expect(digits.textContent, size).toBe(String(count))
        }
      } finally {
        delete document.documentElement.dataset.textSize
        await page.viewport(390, 844)
      }
    },
  )

  it('renders no footer toolbar', async () => {
    show(2)
    await expect.element(page.getByText('Body')).toBeVisible()
    expect(document.querySelector('ion-footer')).toBeNull()
    expect(selecting()).toBe('false')
  })
})
