import { ListPlus, SquarePen, Tag } from 'lucide-react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { MORE_ACTIONS, type MenuItem } from '../../ui/Menu'
import { Screen } from '../../ui/Screen'
import { ADD_TO_LIST } from '../lists/ListPicker'
import {
  DESELECT_ALL_IOS,
  SELECT_ALL_IOS,
  useSelectionToolbar,
  type BulkAction,
} from './SelectionToolbar'
import type { TuneSelection } from './useTuneSelection'

let db: CrosstuneDb

const onExit = vi.fn()
const toggleAll = vi.fn()

const ACTIONS: readonly BulkAction[] = [
  { label: 'Status', icon: Tag, onPress: () => {} },
  { label: 'Edit', icon: SquarePen, onPress: () => {} },
  { label: ADD_TO_LIST, icon: ListPlus, onPress: () => {} },
]
const MORE: readonly MenuItem[] = [{ label: 'Archive 2 tunes', onPress: () => {} }]

function Harness({ count }: { count: number }) {
  const [all, setAll] = useState(false)
  const selection: TuneSelection = {
    count,
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
    <Screen
      title={toolbar.title}
      titleClass={toolbar.titleClass}
      level="top"
      selecting
      start={toolbar.start}
      end={toolbar.end}
    >
      <p>Body</p>
    </Screen>
  )
}

const show = (count: number) => renderScreen(<Harness count={count} />, { db, path: '/catalog' })

const control = (name: string) => page.getByRole('button', { name })

/** An ion-button keeps its native button in a shadow root, which `closest` never leaves. */
function host(name: string): HTMLElement {
  const root = control(name).element().getRootNode()
  return (root as ShadowRoot).host as HTMLElement
}

beforeEach(() => {
  db = openTestDb()
})

describe('useSelectionToolbar on iOS', () => {
  it("reads the count in Apple's capitalization", async () => {
    show(2)
    await expect.element(page.getByText('2 Selected').first()).toBeVisible()
    expect(page.getByText('2 selected').elements()).toHaveLength(0)
  })

  it('leads with Select All and flips it to Deselect All', async () => {
    show(2)
    await expect.element(control(SELECT_ALL_IOS)).toBeVisible()
    await control(SELECT_ALL_IOS).click()
    await expect.poll(() => toggleAll).toHaveBeenCalledOnce()
    await expect.element(control(DESELECT_ALL_IOS)).toBeVisible()
    await expect.element(control(SELECT_ALL_IOS)).not.toBeInTheDocument()
  })

  it('trails with Done, which exits', async () => {
    show(2)
    await expect.element(control('Done')).toBeVisible()
    await control('Done').click()
    await expect.poll(() => onExit).toHaveBeenCalledOnce()
  })

  it('puts no action icons in the toolbar', async () => {
    show(2)
    await expect.element(control('Done')).toBeVisible()
    for (const name of ['Status', 'Edit', ADD_TO_LIST, MORE_ACTIONS]) {
      expect(control(name).elements()).toHaveLength(0)
    }
    expect(document.querySelectorAll('ion-toolbar svg')).toHaveLength(0)
  })

  it('sets the count in tabular numerals on the toolbar and the large title', async () => {
    show(2)
    await expect.element(control('Done')).toBeVisible()
    // Ionic parks an empty clone of the large title on the body to animate the collapse.
    const titles = () => Array.from(document.querySelectorAll('ion-title:not(.ion-cloned-element)'))
    await expect.poll(titles).toHaveLength(2)
    for (const title of titles()) {
      await expect.poll(() => getComputedStyle(title).fontVariantNumeric).toBe('tabular-nums')
    }
  })

  it('keeps the count clear of Deselect All at 320px', async () => {
    await page.viewport(320, 640)
    try {
      show(130)
      await expect.element(control(SELECT_ALL_IOS)).toBeVisible()
      await control(SELECT_ALL_IOS).click()
      await expect.element(control(DESELECT_ALL_IOS)).toBeVisible()
      const title = () =>
        document.querySelector('ion-header ion-title')!.shadowRoot!.querySelector('.toolbar-title')!
      // An iOS title is laid across the whole bar, so a wide leading control sits under it
      // unless the count is given the room the controls leave.
      for (const size of ['regular', 'roomy'] as const) {
        if (size === 'roomy') document.documentElement.dataset.textSize = 'roomy'
        await expect
          .poll(
            () =>
              title().getBoundingClientRect().left -
              host(DESELECT_ALL_IOS).getBoundingClientRect().right,
            { message: size },
          )
          .toBeGreaterThanOrEqual(0)
        const digits = () => document.querySelector('.selection-title-count')!
        await expect
          .poll(() => digits().scrollWidth - digits().clientWidth, { message: size })
          .toBeLessThanOrEqual(0)
      }
    } finally {
      delete document.documentElement.dataset.textSize
      await page.viewport(390, 844)
    }
  })

  it('gives both controls a 44px tap target', async () => {
    show(2)
    await expect.element(control('Done')).toBeVisible()
    for (const name of [SELECT_ALL_IOS, 'Done']) {
      await expect.poll(() => host(name).getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
      await expect.poll(() => host(name).getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
    }
  })
})
