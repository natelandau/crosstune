import { Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { frame, MotionConfig, MotionGlobalConfig } from 'motion/react'
import { setInteractionModality } from 'react-aria'
import { getInteractionModality } from 'react-aria/private/interactions/useFocusVisible'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { drag, dragThrough, longPress, swipeLeft, swipeRight, tap } from '../test/gestures'
import { renderWithProviders } from '../test/render'
import { CANCEL } from './Confirm'
import { Row, type RowAction } from './Row'
import { RowList } from './RowList'
import { SWIPE_ACTION_WIDTH } from './RowSwipe'

// A row settles open or closed by a spring, and a spring's progress is frames the runner may
// not render in time under load. Instant animations land on the next frame, so a check of
// where a row settled never waits on the spring.
beforeEach(() => {
  MotionGlobalConfig.instantAnimations = true
})
afterEach(() => {
  MotionGlobalConfig.instantAnimations = false
})

const actions: RowAction[] = [{ id: 'edit', label: 'Edit', icon: Pencil, onAction: vi.fn() }]

/** Whether the named row has settled open, so a following tap meets the open row. */
function swipeState(name: RegExp): string | null | undefined {
  return page
    .getByRole('row', { name })
    .element()
    .querySelector('[data-swipe]')
    ?.getAttribute('data-swipe')
}

/** Sets React Aria's input modality for this test, restoring the one before it after. */
function useModality(modality: 'keyboard' | 'pointer' | 'virtual'): void {
  const prior = getInteractionModality()
  setInteractionModality(modality)
  // The setter's type refuses null, though the modality starts as null and setting null puts
  // it back there, so no test inherits this one's.
  onTestFinished(() => setInteractionModality(prior as NonNullable<typeof prior>))
}

/** Every swipe state the row takes from now on, in order. */
function watchSwipe(row: Element): string[] {
  const swipe = row.querySelector<HTMLElement>('[data-swipe]')!
  const seen: string[] = []
  const observer = new MutationObserver(() => seen.push(swipe.dataset.swipe ?? ''))
  observer.observe(swipe, { attributes: true, attributeFilter: ['data-swipe'] })
  onTestFinished(() => observer.disconnect())
  return seen
}

/** Whether a tap at the element's center lands on it, not on something drawn over it. */
function uncovered(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  return hit !== null && element.contains(hit)
}

it('reveals the actions on a left swipe', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Old Joe Clark" title="Old Joe Clark" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  await swipeLeft(page.getByRole('row', { name: /Old Joe Clark/ }), 120)
  const edit = page.getByRole('button', { name: 'Edit' })
  await expect.element(edit).toBeVisible()
  await expect.poll(() => uncovered(edit.element())).toBe(true)
})

/** How many pixels of the row's action tray are left unclipped. */
function paintedActionWidth(name: RegExp): number {
  const tray = page.getByRole('row', { name }).element().querySelector('[data-swipe-actions]')!
  const inset = /^inset\(([^)]*)\)$/.exec(getComputedStyle(tray).clipPath)
  const width = tray.getBoundingClientRect().width
  if (!inset) return width
  // A computed inset drops repeated sides, so `inset(0px)` is all four and the left side is
  // the fourth value, else the second, else the first.
  const sides = inset[1]!.split(' ').map((side) => Number.parseFloat(side))
  return width - (sides[3] ?? sides[1] ?? sides[0]!)
}

it("paints none of a closed row's actions, and all of an open one's", async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Bonaparte's Retreat" title="Bonaparte's Retreat" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const name = /Bonaparte's Retreat/
  await expect.poll(() => paintedActionWidth(name)).toBe(0)
  await swipeLeft(page.getByRole('row', { name }), 120)
  await expect.poll(() => swipeState(name)).toBe('open')
  await expect.poll(() => paintedActionWidth(name)).toBe(SWIPE_ACTION_WIDTH)
})

it('never runs an action from a full swipe', async () => {
  const onAction = vi.fn()
  const onRowAction = vi.fn()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    renderWithProviders(
      <RowList label="Tunes" onAction={onRowAction}>
        <Row
          id="1"
          textValue="Sally Goodin"
          title="Sally Goodin"
          actions={[{ ...actions[0]!, onAction }]}
        />
      </RowList>,
      { density: 'touch' },
    )
    await swipeLeft(page.getByRole('row', { name: /Sally Goodin/ }), 380)
    await expect.element(page.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect
      .poll(() => uncovered(page.getByRole('button', { name: 'Edit' }).element()))
      .toBe(true)
    // React Aria clicks a touched row itself on a timeout after the finger lifts.
    vi.runOnlyPendingTimers()
  } finally {
    vi.useRealTimers()
  }
  expect(onAction).not.toHaveBeenCalled()
  expect(onRowAction).not.toHaveBeenCalled()
})

it('opens the menu on a 500ms press', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Squirrel Hunters" title="Squirrel Hunters" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  await longPress(page.getByRole('row', { name: /Squirrel Hunters/ }))
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
})

it('opens the row on a tap', async () => {
  const onRowAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes" onAction={onRowAction}>
      <Row id="1" textValue="Bonaparte's Retreat" title="Bonaparte's Retreat" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  await tap(page.getByRole('row', { name: /Bonaparte/ }))
  await expect.poll(() => onRowAction).toHaveBeenCalledWith('1')
  expect(page.getByRole('menu').query()).toBeNull()
})

it('leaves the menu shut when the long press moves before it lifts', async () => {
  const onRowAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes" onAction={onRowAction}>
      <Row id="1" textValue="Cluck Old Hen" title="Cluck Old Hen" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Cluck Old Hen/ })
  await longPress(row, { thenMove: 40 })
  // The hold itself never opens the row; the tap after it does, which proves the release settled.
  await tap(row)
  await expect.poll(() => onRowAction).toHaveBeenCalledOnce()
  expect(page.getByRole('menu').query()).toBeNull()
})

it('keeps the browser menu from a touch hold out of the way', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Arkansas Traveler" title="Arkansas Traveler" actions={actions} />
      <Row id="2" textValue="Ragtime Annie" title="Ragtime Annie" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const first = page.getByRole('row', { name: /Arkansas Traveler/ }).element()
  const second = page.getByRole('row', { name: /Ragtime Annie/ }).element()
  const firstRect = first.getBoundingClientRect()
  const at = { clientX: firstRect.left + 20, clientY: firstRect.top + 10 }
  first.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'touch',
      isPrimary: true,
      ...at,
    }),
  )
  const menuEvent = new PointerEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
    ...at,
  })
  first.dispatchEvent(menuEvent)
  first.dispatchEvent(
    new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch', isPrimary: true }),
  )
  expect(menuEvent.defaultPrevented).toBe(true)
  // A right-click after it opens a menu the same way, so once that menu shows, any menu the
  // touch hold had opened would show too.
  const secondRect = second.getBoundingClientRect()
  second.dispatchEvent(
    new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      clientX: secondRect.left + 20,
      clientY: secondRect.top + 10,
    }),
  )
  await expect.element(page.getByRole('menu')).toBeVisible()
  // The row menu opens from a touch hold only on a still release, never from the browser's event.
  const menus = page.getByRole('menu').elements()
  expect(menus).toHaveLength(1)
  expect(menus[0]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(secondRect.top)
})

it('keeps a keyboard-pressed action open, in view, and ringed in its label color', async () => {
  const onAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Gold Rush"
        title="Gold Rush"
        actions={[{ id: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onAction }]}
      />
    </RowList>,
    { density: 'touch' },
  )
  await userEvent.keyboard('{Tab}{ArrowRight}')
  const del = page.getByRole('button', { name: 'Delete' })
  await expect.element(del).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => onAction).toHaveBeenCalledOnce()
  await expect.element(del).toHaveFocus()
  await expect.poll(() => uncovered(del.element())).toBe(true)
  const style = getComputedStyle(del.element())
  expect(style.outlineOffset).toBe('-4px')
  expect(style.outlineColor).toBe(style.color)
})

it('runs a revealed action and closes the row', async () => {
  const onAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Billy in the Lowground"
        title="Billy in the Lowground"
        actions={[{ ...actions[0]!, onAction }]}
      />
    </RowList>,
    { density: 'touch' },
  )
  await swipeLeft(page.getByRole('row', { name: /Billy in the Lowground/ }), 120)
  const edit = page.getByRole('button', { name: 'Edit' })
  await expect.poll(() => swipeState(/Billy/)).toBe('open')
  await expect.poll(() => uncovered(edit.element())).toBe(true)
  await edit.click()
  await expect.poll(() => onAction).toHaveBeenCalledOnce()
  await expect.poll(() => uncovered(edit.element())).toBe(false)
})

it('keeps only one row open in a list', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Whiskey Before Breakfast"
        title="Whiskey Before Breakfast"
        actions={actions}
      />
      <Row id="2" textValue="Liberty" title="Liberty" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const [first, second] = page.getByRole('button', { name: 'Edit' }).elements()
  await swipeLeft(page.getByRole('row', { name: /Whiskey/ }), 120)
  await expect.poll(() => swipeState(/Whiskey/)).toBe('open')
  await swipeLeft(page.getByRole('row', { name: /Liberty/ }), 120)
  await expect.poll(() => uncovered(second!)).toBe(true)
  await expect.poll(() => uncovered(first!)).toBe(false)
})

it('closes an open row on a tap elsewhere, without opening the row', async () => {
  const onRowAction = vi.fn()
  renderWithProviders(
    <>
      <RowList label="Tunes" onAction={onRowAction}>
        <Row id="1" textValue="Salt Creek" title="Salt Creek" actions={actions} />
      </RowList>
      <p>Elsewhere</p>
    </>,
    { density: 'touch' },
  )
  const edit = page.getByRole('button', { name: 'Edit' })
  await swipeLeft(page.getByRole('row', { name: /Salt Creek/ }), 120)
  await expect.poll(() => swipeState(/Salt Creek/)).toBe('open')
  await tap(page.getByText('Elsewhere'))
  await expect.poll(() => uncovered(edit.element())).toBe(false)

  // A tap on the open row only closes it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await swipeLeft(page.getByRole('row', { name: /Salt Creek/ }), 120)
    await expect.poll(() => swipeState(/Salt Creek/)).toBe('open')
    // React Aria reports the swipe's own press on a timeout after the lift; let it pass first.
    vi.runOnlyPendingTimers()
    await tap(page.getByText('Salt Creek'))
    vi.runOnlyPendingTimers()
  } finally {
    vi.useRealTimers()
  }
  await expect.poll(() => uncovered(edit.element())).toBe(false)
  expect(onRowAction).not.toHaveBeenCalled()
})

it("refuses a swipe's press when a press elsewhere follows before React Aria reports it", async () => {
  const onRowAction = vi.fn()
  renderWithProviders(
    <>
      <RowList label="Tunes" onAction={onRowAction}>
        <Row id="1" textValue="Ducks on the Pond" title="Ducks on the Pond" actions={actions} />
      </RowList>
      <p>Elsewhere</p>
    </>,
    { density: 'touch' },
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await swipeLeft(page.getByRole('row', { name: /Ducks on the Pond/ }), 120)
    // The next touch lands before React Aria's timeout reports the swipe's press, as its
    // click on the touched row comes a beat after the finger lifts.
    const elsewhere = page.getByText('Elsewhere').element()
    const touch = { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 8 }
    elsewhere.dispatchEvent(new PointerEvent('pointerdown', touch))
    vi.runOnlyPendingTimers()
    elsewhere.dispatchEvent(new PointerEvent('pointerup', touch))
  } finally {
    vi.useRealTimers()
  }
  expect(onRowAction).not.toHaveBeenCalled()
})

it('closes an open row on a scroll', async () => {
  renderWithProviders(
    <div data-testid="scroller" className="h-40 overflow-y-auto">
      <RowList label="Tunes">
        <Row id="1" textValue="Angeline the Baker" title="Angeline the Baker" actions={actions} />
      </RowList>
      <div className="h-[600px]" />
    </div>,
    { density: 'touch' },
  )
  const edit = page.getByRole('button', { name: 'Edit' })
  await swipeLeft(page.getByRole('row', { name: /Angeline/ }), 120)
  await expect.poll(() => swipeState(/Angeline/)).toBe('open')
  page.getByTestId('scroller').element().scrollTop = 4
  await expect.poll(() => uncovered(edit.element())).toBe(false)
})

it('swipes an open row shut', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Red Wing" title="Red Wing" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Red Wing/ })
  const edit = page.getByRole('button', { name: 'Edit' })
  await swipeLeft(row, 120)
  await expect.poll(() => swipeState(/Red Wing/)).toBe('open')
  await swipeRight(row, 120)
  await expect.poll(() => uncovered(edit.element())).toBe(false)
})

it('stays shut after a short swipe', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="June Apple" title="June Apple" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const edit = page.getByRole('button', { name: 'Edit' })
  await drag(page.getByRole('row', { name: /June Apple/ }), -SWIPE_ACTION_WIDTH / 4, 0, {
    steps: 24,
  })
  await expect.poll(() => uncovered(page.getByText('June Apple').element())).toBe(true)
  await expect.poll(() => uncovered(edit.element())).toBe(false)
})

it('ignores a mouse drag', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Fisher's Hornpipe" title="Fisher's Hornpipe" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  await swipeLeft(page.getByRole('row', { name: /Fisher's Hornpipe/ }), 120, {
    pointerType: 'mouse',
  })
  await expect.poll(() => uncovered(page.getByText("Fisher's Hornpipe").element())).toBe(true)
  expect(uncovered(page.getByRole('button', { name: 'Edit' }).element())).toBe(false)
})

it('fills every action in its tone at one width, with a short label that keeps the full name', async () => {
  const toned: RowAction[] = [
    { id: 'edit', label: 'Edit', icon: Pencil, onAction: vi.fn() },
    {
      id: 'archive',
      label: 'Archive tune',
      shortLabel: 'Archive',
      icon: TriangleAlert,
      tone: 'warning',
      onAction: vi.fn(),
    },
    { id: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onAction: vi.fn() },
  ]
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Golden Slippers" title="Golden Slippers" actions={toned} />
    </RowList>,
    { density: 'touch' },
  )
  const buttons = ['Edit', 'Archive tune', 'Delete'].map(
    (name) => page.getByRole('button', { name }).element() as HTMLElement,
  )
  const widths = buttons.map((button) => button.getBoundingClientRect().width)
  expect(new Set(widths)).toEqual(new Set([SWIPE_ACTION_WIDTH]))
  const row = page.getByRole('row', { name: /Golden Slippers/ }).element()
  for (const button of buttons) {
    expect(button.getBoundingClientRect().height).toBe(row.getBoundingClientRect().height)
  }
  expect(buttons[1]!.textContent).toBe('Archive')
  const fills = buttons.map((button) => getComputedStyle(button).backgroundColor)
  expect(fills[1]).toBe('rgb(201, 52, 0)')
  expect(fills[2]).toBe('rgb(217, 45, 32)')
  expect(new Set(fills).size).toBe(3)
})

it('opens the row when the keyboard reaches an action', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Temperance Reel" title="Temperance Reel" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  await userEvent.keyboard('{Tab}{ArrowRight}')
  const edit = page.getByRole('button', { name: 'Edit' })
  await expect.element(edit).toHaveFocus()
  await expect.poll(() => uncovered(edit.element())).toBe(true)
})

it('ends a swipe without cancelling the pointer for anything else listening', async () => {
  const cancels = vi.fn()
  window.addEventListener('pointercancel', cancels, true)
  onTestFinished(() => window.removeEventListener('pointercancel', cancels, true))
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Down Yonder" title="Down Yonder" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  await swipeLeft(page.getByRole('row', { name: /Down Yonder/ }), 120)
  await expect.poll(() => swipeState(/Down Yonder/)).toBe('open')
  expect(cancels).not.toHaveBeenCalled()
})

it('never selects a row from a swipe or a hold', async () => {
  const onSelectionChange = vi.fn()
  renderWithProviders(
    <RowList label="Tunes" selectionMode="multiple" onSelectionChange={onSelectionChange}>
      <Row id="1" textValue="Shove the Pig" title="Shove the Pig" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Shove the Pig/ })
  await longPress(row)
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  await page.getByRole('button', { name: CANCEL }).click()
  await expect.poll(() => page.getByRole('dialog').query()).toBeNull()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await swipeLeft(row, 120)
    await expect.poll(() => swipeState(/Shove the Pig/)).toBe('open')
    // React Aria clicks a touched row itself on a timeout after the finger lifts.
    vi.runOnlyPendingTimers()
  } finally {
    vi.useRealTimers()
  }
  expect(onSelectionChange).not.toHaveBeenCalled()
  await expect.element(row).toHaveAttribute('aria-selected', 'false')
})

it('never selects a row that also opens from a hold', async () => {
  const onSelectionChange = vi.fn()
  const onRowAction = vi.fn()
  renderWithProviders(
    <RowList
      label="Tunes"
      selectionMode="multiple"
      onSelectionChange={onSelectionChange}
      onAction={onRowAction}
    >
      <Row id="1" textValue="Lost Indian" title="Lost Indian" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Lost Indian/ })
  await longPress(row)
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  expect(onSelectionChange).not.toHaveBeenCalled()
  expect(onRowAction).not.toHaveBeenCalled()
  await expect.element(row).toHaveAttribute('aria-selected', 'false')
})

it('settles a swiped row without a spring under reduced motion', async () => {
  // This one measures the motion itself, which instant animations would stand in for.
  MotionGlobalConfig.instantAnimations = false
  renderWithProviders(
    <MotionConfig reducedMotion="always">
      <RowList label="Tunes">
        <Row id="1" textValue="Eighth of January" title="Eighth of January" actions={actions} />
      </RowList>
    </MotionConfig>,
    { density: 'touch' },
  )
  const content = () =>
    page.getByText('Eighth of January').element().parentElement!.parentElement as HTMLElement
  const offset = () => new DOMMatrix(getComputedStyle(content()).transform).m41
  await drag(page.getByRole('row', { name: /Eighth of January/ }), -120, 0)
  const lifted = offset()
  // Every frame from the lift on: a spring would pass through offsets between the two.
  const offsets: number[] = []
  let sampling = true
  const sample = () => {
    if (!sampling) return
    offsets.push(offset())
    requestAnimationFrame(sample)
  }
  sample()
  try {
    await expect.poll(offset).toBe(-SWIPE_ACTION_WIDTH)
  } finally {
    sampling = false
  }
  expect(offsets.filter((x) => x !== lifted && x !== -SWIPE_ACTION_WIDTH)).toEqual([])
})

it('neither buzzes nor holds a row with no menu', async () => {
  const vibrate = vi.spyOn(navigator, 'vibrate')
  const onRowAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes" onAction={onRowAction}>
      <Row id="1" textValue="Jaybird" title="Jaybird" />
    </RowList>,
    { density: 'touch' },
  )
  await longPress(page.getByRole('row', { name: /Jaybird/ }))
  await expect.poll(() => onRowAction).toHaveBeenCalledWith('1')
  expect(vibrate).not.toHaveBeenCalled()
})

it('keeps the browser menu out of a touch hold that reports as a mouse event', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Mississippi Sawyer" title="Mississippi Sawyer" actions={actions} />
      <Row id="2" textValue="Leather Britches" title="Leather Britches" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  // A finger lands on the row's content, so that is what the browser targets.
  const first = page.getByText('Mississippi Sawyer').element()
  const rect = first.getBoundingClientRect()
  const at = { clientX: rect.left + 20, clientY: rect.top + 10 }
  first.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'touch',
      isPrimary: true,
      ...at,
    }),
  )
  const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...at })
  first.dispatchEvent(menuEvent)
  first.dispatchEvent(
    new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch', isPrimary: true }),
  )
  expect(menuEvent.defaultPrevented).toBe(true)
  // A menu opened after it shows the same way, so once that one shows, any menu the touch hold
  // had opened would show too.
  await longPress(page.getByRole('row', { name: /Leather Britches/ }))
  await expect.element(page.getByRole('dialog', { name: 'Leather Britches' })).toBeVisible()
  expect(page.getByRole('dialog').elements()).toHaveLength(1)
})

it('keeps the row open after a screen reader presses an action', async () => {
  const onAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Big Sciota"
        title="Big Sciota"
        actions={[{ ...actions[0]!, onAction }]}
      />
    </RowList>,
    { density: 'touch' },
  )
  const edit = page.getByRole('button', { name: 'Edit' })
  // Focus as a screen reader moves it, which React Aria reads as the virtual modality.
  useModality('virtual')
  ;(edit.element() as HTMLElement).focus()
  await expect.poll(() => swipeState(/Big Sciota/)).toBe('open')
  // A click with no pointer before it is how React Aria sees a screen reader's activation.
  ;(edit.element() as HTMLElement).click()
  await expect.poll(() => onAction).toHaveBeenCalledOnce()
  await expect.element(edit).toHaveFocus()
  await expect.poll(() => uncovered(edit.element())).toBe(true)
  expect(swipeState(/Big Sciota/)).toBe('open')
})

it('leaves the row closed for focus after a pointer, and opens it on a key there', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Sail Away Ladies" title="Sail Away Ladies" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Sail Away Ladies/ })
  await expect.element(row).toBeVisible()
  const seen = watchSwipe(row.element())
  // Focus handed back after a tap, as a closing overlay hands it.
  useModality('pointer')
  const edit = page.getByRole('button', { name: 'Edit' })
  ;(edit.element() as HTMLElement).focus()
  await expect.element(edit).toHaveFocus()
  // The row decides as focus arrives, so by now it has.
  expect(seen).toEqual([])
  await userEvent.keyboard('{Shift}')
  await expect.poll(() => swipeState(/Sail Away Ladies/)).toBe('open')
})

it('opens the row and runs the action on Enter after focus a tap handed back', async () => {
  const onAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Shady Grove"
        title="Shady Grove"
        actions={[{ ...actions[0]!, onAction }]}
      />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Shady Grove/ })
  await expect.element(row).toBeVisible()
  useModality('pointer')
  const edit = page.getByRole('button', { name: 'Edit' })
  ;(edit.element() as HTMLElement).focus()
  await expect.element(edit).toHaveFocus()
  expect(swipeState(/Shady Grove/)).toBe('closed')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => onAction).toHaveBeenCalledOnce()
  await expect.poll(() => swipeState(/Shady Grove/)).toBe('open')
})

it('runs only the action, never the row, for a touch tap on a swipe action', async () => {
  const onAction = vi.fn()
  const onRowAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes" onAction={onRowAction}>
      <Row
        id="1"
        textValue="Elzic's Farewell"
        title="Elzic's Farewell"
        actions={[{ ...actions[0]!, onAction }]}
      />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Elzic's Farewell/ })
  await expect.element(row).toBeVisible()
  const edit = page.getByRole('button', { name: 'Edit' })
  // React Aria reports a touch press 80ms after its lift when no click follows, so the swipe's
  // report and the tap's both run on this clock, in the order a phone can produce them: the
  // finger lands on the action, the swipe's report arrives and is refused, then the finger
  // lifts and the action's own report runs.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await swipeLeft(row, 120)
    await expect.poll(() => uncovered(edit.element())).toBe(true)
    await tap(edit, { beforeLift: () => void vi.advanceTimersByTime(80) })
    vi.advanceTimersByTime(80)
  } finally {
    vi.useRealTimers()
  }
  await expect.poll(() => onAction).toHaveBeenCalledOnce()
  expect(onRowAction).not.toHaveBeenCalled()
})

it('activates a row for a screen reader after a swipe was refused', async () => {
  const onSelectionChange = vi.fn()
  renderWithProviders(
    <RowList label="Tunes" selectionMode="multiple" onSelectionChange={onSelectionChange}>
      <Row id="1" textValue="Cluck Old Hen" title="Cluck Old Hen" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Cluck Old Hen/ })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await swipeLeft(row, 120)
    await expect.poll(() => swipeState(/Cluck Old Hen/)).toBe('open')
    // The press React Aria reports for the swipe is refused.
    vi.runOnlyPendingTimers()
  } finally {
    vi.useRealTimers()
  }
  expect(onSelectionChange).not.toHaveBeenCalled()
  // A click with no pointerdown or keydown before it is a screen reader's activation; it
  // retries because the mark clears a frame after the refusal.
  await expect
    .poll(() => {
      ;(row.element() as HTMLElement).click()
      return onSelectionChange.mock.calls.length
    })
    .toBeGreaterThan(0)
})

it('opens on a slow swipe past half its actions', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Rocky Road to Dublin" title="Rocky Road to Dublin" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  // Slow enough to be no flick, so only where the finger let go decides.
  await drag(page.getByRole('row', { name: /Rocky Road/ }), -SWIPE_ACTION_WIDTH, 0, {
    steps: 48,
  })
  await expect.poll(() => swipeState(/Rocky Road/)).toBe('open')
})

/**
 * Resolves after the next Motion frame. A drag helper returns once the drag's end handler has
 * run; this frame gives what the handler set time to render, so a check after it reads the row
 * as the handler left it rather than as it was before.
 */
const afterDragEnd = () => new Promise<void>((resolve) => frame.postRender(() => resolve()))

it('closes an open row on a tap that wanders a few pixels', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Soldier's Joy" title="Soldier's Joy" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Soldier's Joy/ })
  await swipeLeft(row, 120)
  await expect.poll(() => swipeState(/Soldier's Joy/)).toBe('open')
  // Far enough for Motion to start a drag, short of locking it to a direction.
  await dragThrough(row, [{ x: 5, y: 0 }])
  await afterDragEnd()
  await expect.poll(() => swipeState(/Soldier's Joy/)).toBe('closed')
  await expect
    .poll(() => uncovered(page.getByRole('button', { name: 'Edit' }).element()))
    .toBe(false)
})

it('leaves a row as it was when a drag goes vertical before it goes sideways', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Forked Deer" title="Forked Deer" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Forked Deer/ })
  // Down far enough that Motion locks the drag to vertical, then sideways much further.
  const downThenAcross = (dx: number) => [
    { x: 0, y: 15 },
    ...Array.from({ length: 12 }, (_, step) => ({ x: (dx * (step + 1)) / 12, y: 15 })),
  ]
  await dragThrough(row, downThenAcross(-120))
  await afterDragEnd()
  await expect.poll(() => swipeState(/Forked Deer/)).toBe('closed')

  await swipeLeft(row, 120)
  await expect.poll(() => swipeState(/Forked Deer/)).toBe('open')
  await dragThrough(row, downThenAcross(120))
  await afterDragEnd()
  await expect.poll(() => swipeState(/Forked Deer/)).toBe('open')
})

it("runs a remounted row's action though its last swipe was never reported", async () => {
  const onRowAction = vi.fn()
  const list = (shown: boolean) => (
    <RowList label="Tunes" onAction={onRowAction}>
      {shown && (
        <Row id="1" textValue="Arkansas Traveler" title="Arkansas Traveler" actions={actions} />
      )}
    </RowList>
  )
  const { rerender } = renderWithProviders(list(true), { density: 'touch' })
  const row = () => page.getByRole('row', { name: /Arkansas Traveler/ })
  // A lift that React Aria never reports as a press, as when the finger ends off the row: its
  // timed press is dropped with the fake clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await swipeLeft(row(), 120)
  } finally {
    vi.useRealTimers()
  }
  rerender(list(false))
  await expect.poll(() => row().query()).toBeNull()
  rerender(list(true))
  await expect.element(row()).toBeInTheDocument()
  // A click with no pointerdown before it is a screen reader's activation.
  ;(row().element() as HTMLElement).click()
  await expect.poll(() => onRowAction).toHaveBeenCalledWith('1')
})

it("runs a row's action on pointer though its last touch swipe was never reported", async () => {
  const onRowAction = vi.fn()
  renderWithProviders(
    <RowList label="Tunes" onAction={onRowAction}>
      <Row id="1" textValue="Arkansas Traveler" title="Arkansas Traveler" actions={actions} />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: /Arkansas Traveler/ })
  // A lift that React Aria never reports as a press: its timed press is dropped with the fake
  // clock, so the swipe's mark stays.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await swipeLeft(row, 120)
  } finally {
    vi.useRealTimers()
  }
  // A mouse arriving swaps the swipe layer out of the same row.
  document.documentElement.dataset.density = 'pointer'
  await expect.poll(() => row.element().querySelector('[data-swipe]')).toBeNull()
  ;(row.element() as HTMLElement).click()
  await expect.poll(() => onRowAction).toHaveBeenCalledWith('1')
})
