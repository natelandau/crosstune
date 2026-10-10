import { Pencil } from 'lucide-react'
import { MotionGlobalConfig } from 'motion/react'
import { useEffect, useState } from 'react'
import type { Key } from 'react-aria-components'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { movedAnnouncement } from './reorderCopy'
import { longPress, longPressDrag, swipeLeft } from '../test/gestures'
import { renderWithProviders } from '../test/render'
import { moveRowLabel, useReorderAnnouncer, type FrameSource } from './reorder'
import { Row, type RowAction } from './Row'
import { RowList } from './RowList'
import { LONG_PRESS_MS } from './RowSwipe'

// Rows shift aside by a spring while a touch drag passes them; instant animations land a
// check of where they settled on the next frame instead of the spring's last.
beforeEach(() => {
  MotionGlobalConfig.instantAnimations = true
})
afterEach(() => {
  MotionGlobalConfig.instantAnimations = false
})

const TUNES = [
  { id: 'a', title: 'Forked Deer' },
  { id: 'b', title: 'Angeline the Baker' },
  { id: 'c', title: 'Cluck Old Hen' },
  { id: 'd', title: "Soldier's Joy" },
]

const actions: RowAction[] = [{ id: 'edit', label: 'Edit', icon: Pencil, onAction: vi.fn() }]

const moved = <T extends { id: string }>(rows: readonly T[], key: Key, to: number): T[] => {
  const from = rows.findIndex((row) => row.id === key)
  const next = rows.filter((_, index) => index !== from)
  next.splice(to, 0, rows[from]!)
  return next
}

/** `tall` rows take a second line, so rows of two heights share the list. */
type Tune = { id: string; title: string; tall?: boolean }
type Sync = (update: (rows: Tune[]) => Tune[]) => void

function Tunes({
  onReorder,
  tunes = TUNES,
  withActions = false,
  selectionMode,
  onSync,
  onAction,
  showLater,
  frames,
  loading = false,
  disabledKeys,
}: {
  onReorder: (key: Key, to: number) => void
  disabledKeys?: Key[]
  frames?: FrameSource
  /** Renders as a screen does before its rows can move: with no `onReorder`. */
  loading?: boolean
  tunes?: Tune[]
  onAction?: (key: Key) => void
  withActions?: boolean
  selectionMode?: 'multiple'
  /** Receives the rows' setter, so a test can stand in for a sync. */
  onSync?: (sync: Sync) => void
  /** Shows a move this many ms after it is made, as a store write then a live read does. */
  showLater?: number
}) {
  const [rows, setRows] = useState(tunes)
  const { announce, region } = useReorderAnnouncer()
  useEffect(() => onSync?.(setRows), [onSync])
  return (
    <>
      <RowList
        label="Tunes"
        selectionMode={selectionMode}
        onAction={onAction}
        disabledKeys={disabledKeys}
        frames={frames}
        onReorder={
          loading
            ? undefined
            : (key, to) => {
                onReorder(key, to)
                const next = moved(rows, key, to)
                const show = () => {
                  setRows(next)
                  announce(movedAnnouncement(next[to]!.title, to + 1, next.length))
                }
                if (showLater === undefined) show()
                else setTimeout(show, showLater)
              }
        }
        moveLabel={(item) => moveRowLabel(item.title)}
      >
        {rows.map((row) => (
          <Row
            key={row.id}
            id={row.id}
            textValue={row.title}
            title={row.title}
            stacked={row.tall}
            detail={row.tall ? 'Two lines' : undefined}
            actions={withActions ? actions : []}
          />
        ))}
      </RowList>
      <div data-testid="announcer">{region}</div>
    </>
  )
}

const shownTitles = () =>
  page
    .getByRole('row')
    .elements()
    .flatMap((row) => row.querySelector('[data-row-title]')?.textContent ?? [])

const rowHeight = () =>
  page
    .getByRole('row', { name: /Forked Deer/ })
    .element()
    .getBoundingClientRect().height

it('reorders on a mouse drag of the whole row', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} />, { density: 'pointer' })
  const target = page.getByRole('row', { name: /Cluck Old Hen/ })
  await userEvent.dragAndDrop(page.getByRole('row', { name: /Forked Deer/ }), target, {
    // The lower part of the row, so the drop lands below it.
    targetPosition: { x: 40, y: (target.element().getBoundingClientRect().height * 3) / 4 },
  })
  await expect.poll(() => onReorder).toHaveBeenCalledOnce()
  expect(onReorder).toHaveBeenCalledWith('a', 2)
  await expect
    .poll(shownTitles)
    .toEqual(['Angeline the Baker', 'Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])
})

/** A mouse or pen press on the row's title, which `to` moves by `dy` px and `drop` releases. */
function mousePress(name: RegExp, pointerType: 'mouse' | 'pen' = 'mouse') {
  const content = page.getByRole('row', { name }).element().querySelector('[data-row-title]')!
  const rect = content.getBoundingClientRect()
  const at = { clientX: rect.left + 5, clientY: rect.top + 5 }
  const mouse = { bubbles: true, cancelable: true, pointerType, isPrimary: true }
  content.dispatchEvent(new PointerEvent('pointerdown', { ...mouse, ...at, button: 0 }))
  return {
    to: (dy: number, steps = 8) => {
      for (let step = 1; step <= steps; step++) {
        const clientY = at.clientY + (dy * step) / steps
        content.dispatchEvent(new PointerEvent('pointermove', { ...mouse, ...at, clientY }))
      }
    },
    // A browser clicks wherever the release lands, as it does after a drag.
    drop: () => {
      content.dispatchEvent(new PointerEvent('pointerup', { ...mouse, ...at, button: 0 }))
      content.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...at }))
    },
  }
}

const row = (name: RegExp) => page.getByRole('row', { name })

it('lifts a mouse-dragged row, then lands it without opening or selecting it', async () => {
  const onReorder = vi.fn()
  const onAction = vi.fn()
  renderWithProviders(
    <Tunes onReorder={onReorder} onAction={onAction} selectionMode="multiple" />,
    { density: 'pointer' },
  )
  const drag = mousePress(/Forked Deer/)
  drag.to(rowHeight() * 2.5)
  await expect.element(row(/Forked Deer/)).toHaveAttribute('data-lifted')
  drag.drop()
  await expect.poll(() => onReorder).toHaveBeenCalledOnce()
  expect(onReorder).toHaveBeenCalledWith('a', 2)
  await expect
    .poll(shownTitles)
    .toEqual(['Angeline the Baker', 'Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])
  await expect.element(row(/Forked Deer/)).not.toHaveAttribute('data-reordering')
  await expect.element(row(/Forked Deer/)).toHaveAttribute('aria-selected', 'false')
  expect(onAction).not.toHaveBeenCalled()
})

it('drags a row with a pen on a pointer layout as a mouse does', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} />, { density: 'pointer' })
  const drag = mousePress(/Forked Deer/, 'pen')
  drag.to(rowHeight() * 2.5)
  await expect.element(row(/Forked Deer/)).toHaveAttribute('data-lifted')
  drag.drop()
  await expect.poll(() => onReorder).toHaveBeenCalledWith('a', 2)
})

it('drags a row with a pen on a touch layout only after a long press', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} />, { density: 'touch' })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const stroke = mousePress(/Forked Deer/, 'pen')
    stroke.to(rowHeight() * 2.5)
    expect(
      row(/Forked Deer/)
        .element()
        .hasAttribute('data-lifted'),
    ).toBe(false)
    stroke.drop()
    vi.runOnlyPendingTimers()
  } finally {
    vi.useRealTimers()
  }
  expect(onReorder).not.toHaveBeenCalled()
  await longPressDrag(row(/Forked Deer/), rowHeight() * 2.5, { pointerType: 'pen' })
  await expect.poll(() => onReorder).toHaveBeenCalledWith('a', 2)
})

it('never drags a disabled row', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} disabledKeys={['a']} />, {
    density: 'pointer',
  })
  await expect.element(row(/Forked Deer/)).toHaveAttribute('data-disabled')
  const drag = mousePress(/Forked Deer/)
  drag.to(rowHeight() * 2.5)
  await expect.element(row(/Forked Deer/)).not.toHaveAttribute('data-lifted')
  drag.drop()
  expect(onReorder).not.toHaveBeenCalled()
})

it('takes a mouse press that barely moves as a click, not a drag', async () => {
  const onReorder = vi.fn()
  const onAction = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} onAction={onAction} />, {
    density: 'pointer',
  })
  await row(/Forked Deer/).click()
  await expect.poll(() => onAction).toHaveBeenCalledWith('a')
  const drag = mousePress(/Forked Deer/)
  drag.to(2, 2)
  await expect.element(row(/Forked Deer/)).not.toHaveAttribute('data-lifted')
  drag.drop()
  expect(onReorder).not.toHaveBeenCalled()
})

it('puts the rows back when Escape cancels a mouse drag', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} />, { density: 'pointer' })
  const drag = mousePress(/Forked Deer/)
  drag.to(rowHeight() * 2.5)
  await expect.element(row(/Forked Deer/)).toHaveAttribute('data-lifted')
  await userEvent.keyboard('{Escape}')
  await expect.element(row(/Forked Deer/)).not.toHaveAttribute('data-reordering')
  drag.drop()
  expect(onReorder).not.toHaveBeenCalled()
  expect(shownTitles()).toEqual(TUNES.map((tune) => tune.title))
})

it('reorders from the keyboard through the move button and returns focus to the row', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} />, { density: 'pointer' })
  // A pointer resting over the list must not pull focus off the moved row.
  await userEvent.hover(page.getByRole('row', { name: /Soldier's Joy/ }))
  await userEvent.keyboard('{Tab}{ArrowRight}')
  const move = page.getByRole('button', { name: moveRowLabel('Forked Deer') })
  await expect.element(move).toHaveFocus()
  expect(getComputedStyle(move.element()).opacity).not.toBe('0')
  // Each key waits for the drag to take the one before it, as a person's keys would.
  const dropTarget = () => document.activeElement?.getAttribute('aria-label')
  await userEvent.keyboard('{Enter}')
  await expect.poll(dropTarget).toMatch(/^Insert /)
  for (let step = 0; step < 2; step++) {
    const before = dropTarget()
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(dropTarget).not.toBe(before)
  }
  expect(dropTarget()).toBe("Insert between Cluck Old Hen and Soldier's Joy")
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => onReorder).toHaveBeenCalledOnce()
  expect(onReorder).toHaveBeenCalledWith('a', 2)
  await expect
    .poll(shownTitles)
    .toEqual(['Angeline the Baker', 'Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])
  await expect.element(page.getByRole('row', { name: /Forked Deer/ })).toHaveFocus()
  await expect
    .element(page.getByTestId('announcer').getByRole('status'))
    .toHaveTextContent(movedAnnouncement('Forked Deer', 3, 4))
})

it('hides the move button until it has keyboard focus', async () => {
  renderWithProviders(<Tunes onReorder={vi.fn()} />, { density: 'pointer' })
  const move = page.getByRole('button', { name: moveRowLabel('Forked Deer') })
  await expect.element(move).toBeInTheDocument()
  expect(getComputedStyle(move.element()).opacity).toBe('0')
})

it('reorders on a touch drag after a long press', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} withActions />, { density: 'touch' })
  await longPressDrag(page.getByRole('row', { name: /Forked Deer/ }), rowHeight() * 2.5)
  await expect.poll(() => onReorder).toHaveBeenCalledOnce()
  expect(onReorder).toHaveBeenCalledWith('a', 2)
  await expect
    .poll(shownTitles)
    .toEqual(['Angeline the Baker', 'Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])
  expect(page.getByRole('menu').query()).toBeNull()
  // Every row is back in its own place once the move is in the order.
  for (const row of page.getByRole('row').elements()) {
    expect(new DOMMatrix(getComputedStyle(row).transform).m42).toBe(0)
  }
})

it('never opens or selects the row a touch drag moved', async () => {
  const onAction = vi.fn()
  renderWithProviders(<Tunes onReorder={vi.fn()} onAction={onAction} selectionMode="multiple" />, {
    density: 'touch',
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await longPressDrag(page.getByRole('row', { name: /Forked Deer/ }), rowHeight() * 2.5)
    // React Aria reports a touched row's press on a timeout after the finger lifts.
    vi.runOnlyPendingTimers()
  } finally {
    vi.useRealTimers()
  }
  expect(onAction).not.toHaveBeenCalled()
  await expect
    .element(page.getByRole('row', { name: /Forked Deer/ }))
    .toHaveAttribute('aria-selected', 'false')
})

/** Fires a touch press on the row's content and returns what fires on it and lifts it. */
function press(name: RegExp) {
  const row = page.getByRole('row', { name }).element()
  const content = row.querySelector('[data-row-title]')!
  const rect = content.getBoundingClientRect()
  const at = { clientX: rect.left + 5, clientY: rect.top + 5 }
  const touch = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }
  content.dispatchEvent(new PointerEvent('pointerdown', { ...touch, ...at }))
  return {
    fire: (event: Event) => {
      content.dispatchEvent(event)
      return event.defaultPrevented
    },
    lift: () => content.dispatchEvent(new PointerEvent('pointerup', { ...touch, ...at })),
  }
}

it("keeps the page from scrolling under a held row, and the browser's own drag out", async () => {
  renderWithProviders(<Tunes onReorder={vi.fn()} />, { density: 'touch' })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const touch = press(/Forked Deer/)
    const move = () => new TouchEvent('touchmove', { bubbles: true, cancelable: true })
    expect(touch.fire(move())).toBe(false)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(touch.fire(move())).toBe(true)
    expect(touch.fire(new DragEvent('dragstart', { bubbles: true, cancelable: true }))).toBe(true)
    touch.lift()
  } finally {
    vi.useRealTimers()
  }
  // The menu a still release opens is not this test's concern; the row has none.
  expect(page.getByRole('menu').query()).toBeNull()
})

it('reorders on a touch drag upward', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} />, { density: 'touch' })
  await longPressDrag(page.getByRole('row', { name: /Soldier's Joy/ }), -rowHeight() * 2.5)
  await expect.poll(() => onReorder).toHaveBeenCalledWith('d', 1)
})

it('opens the row menu on a long press released in place, and does not reorder', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} withActions />, { density: 'touch' })
  await longPress(page.getByRole('row', { name: /Forked Deer/ }))
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  expect(onReorder).not.toHaveBeenCalled()
})

it('opens the actions on a horizontal swipe, and does not reorder', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} withActions />, { density: 'touch' })
  await swipeLeft(page.getByRole('row', { name: /Forked Deer/ }), 120)
  await expect
    .poll(() =>
      page
        .getByRole('row', { name: /Forked Deer/ })
        .element()
        .querySelector('[data-swipe]')
        ?.getAttribute('data-swipe'),
    )
    .toBe('open')
  expect(onReorder).not.toHaveBeenCalled()
  expect(shownTitles()).toEqual(TUNES.map((tune) => tune.title))
})

it('drops a touch drag among the rows on screen when a sync reorders them mid-drag', async () => {
  const onReorder = vi.fn()
  let sync: Sync | undefined
  renderWithProviders(
    <Tunes
      onReorder={onReorder}
      onSync={(set) => {
        sync = set
      }}
    />,
    { density: 'touch' },
  )
  await longPressDrag(page.getByRole('row', { name: /Forked Deer/ }), rowHeight() * 2.5, {
    midway: async () => {
      // Another device moved Soldier's Joy to the top.
      sync!((rows) => [rows[3]!, ...rows.slice(0, 3)])
      await expect.poll(() => shownTitles()[0]).toBe("Soldier's Joy")
    },
  })
  await expect.poll(() => onReorder).toHaveBeenCalledOnce()
  expect(onReorder).toHaveBeenCalledWith('a', 2)
  await expect
    .poll(shownTitles)
    .toEqual(["Soldier's Joy", 'Angeline the Baker', 'Forked Deer', 'Cluck Old Hen'])
})

it('keeps selection working in a reorderable list', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} selectionMode="multiple" />, {
    density: 'pointer',
  })
  const row = page.getByRole('row', { name: /Cluck Old Hen/ })
  await row.click()
  await expect.element(row).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('row', { name: /Forked Deer/ }).click()
  await expect.element(row).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(page.getByRole('row', { name: /Forked Deer/ }))
    .toHaveAttribute('aria-selected', 'true')
  expect(onReorder).not.toHaveBeenCalled()
})

it('announces each move, the same words twice included', async () => {
  function Announcer() {
    const { announce, region } = useReorderAnnouncer()
    return (
      <>
        <button type="button" onClick={() => announce(movedAnnouncement('Forked Deer', 2, 4))}>
          Announce
        </button>
        <div data-testid="announcer">{region}</div>
      </>
    )
  }
  renderWithProviders(<Announcer />)
  const status = page.getByTestId('announcer').getByRole('status')
  await expect.element(status).toHaveAttribute('aria-live', 'polite')
  await page.getByRole('button', { name: 'Announce' }).click()
  await expect.element(status).toHaveTextContent(movedAnnouncement('Forked Deer', 2, 4))
  const first = status.element().textContent
  await page.getByRole('button', { name: 'Announce' }).click()
  // A live region speaks a change only, so a repeat must still change the text.
  await expect.poll(() => status.element().textContent).not.toBe(first)
  await expect.element(status).toHaveTextContent(movedAnnouncement('Forked Deer', 2, 4))
})

// Inside React Aria's 50ms settling window after a drop, and past it.
it.each([30, 80])(
  'returns focus to the moved row when the list shows the move %ims after the drop',
  async (showLater) => {
    const onReorder = vi.fn()
    renderWithProviders(<Tunes onReorder={onReorder} showLater={showLater} />, {
      density: 'pointer',
    })
    // A pointer resting over the list must not pull focus off the moved row.
    await userEvent.hover(page.getByRole('row', { name: /Soldier's Joy/ }))
    await userEvent.keyboard('{Tab}{ArrowRight}')
    await expect
      .element(page.getByRole('button', { name: moveRowLabel('Forked Deer') }))
      .toHaveFocus()
    const dropTarget = () => document.activeElement?.getAttribute('aria-label')
    await userEvent.keyboard('{Enter}')
    await expect.poll(dropTarget).toMatch(/^Insert /)
    for (let step = 0; step < 2; step++) {
      const before = dropTarget()
      await userEvent.keyboard('{ArrowDown}')
      await expect.poll(dropTarget).not.toBe(before)
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await userEvent.keyboard('{Enter}')
      await expect.poll(() => onReorder).toHaveBeenCalledWith('a', 2)
      expect(shownTitles()).toEqual(TUNES.map((tune) => tune.title))
      vi.advanceTimersByTime(showLater)
      await expect.poll(() => shownTitles()[2]).toBe('Forked Deer')
      vi.advanceTimersByTime(100)
    } finally {
      vi.useRealTimers()
    }
    await expect
      .poll(shownTitles)
      .toEqual(['Angeline the Baker', 'Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])
    await expect.element(page.getByRole('row', { name: /Forked Deer/ })).toHaveFocus()
  },
)

it('offers no mouse or keyboard drag while rows are selected', async () => {
  const onReorder = vi.fn()
  renderWithProviders(<Tunes onReorder={onReorder} selectionMode="multiple" />, {
    density: 'pointer',
  })
  const move = page.getByRole('button', { name: moveRowLabel('Forked Deer') })
  await expect.element(move).toBeEnabled()
  await expect
    .element(page.getByRole('row', { name: /Forked Deer/ }))
    .toHaveAttribute('draggable', 'true')
  await page.getByRole('row', { name: /Cluck Old Hen/ }).click()
  await expect.element(move).toBeDisabled()
  await expect.element(row(/Forked Deer/)).not.toHaveAttribute('draggable', 'true')
  const drag = mousePress(/Forked Deer/)
  drag.to(rowHeight() * 2.5)
  await expect.element(row(/Forked Deer/)).not.toHaveAttribute('data-lifted')
  drag.drop()
  expect(onReorder).not.toHaveBeenCalled()
})

/** Frames a test steps by hand, each a fixed 16ms after the last. */
function manualFrames() {
  let step: ((deltaMs: number) => void) | null = null
  const frames: FrameSource = (next) => {
    step = next
    return () => {
      step = null
    }
  }
  return {
    frames,
    /** Steps frames until `done` holds, at most `limit` of them. */
    runUntil: (done: () => boolean, limit = 500) => {
      for (let count = 0; count < limit && step && !done(); count++) step(16)
    },
  }
}

const TWELVE = Array.from({ length: 12 }, (_, index) => ({
  id: `t${index}`,
  title: `Tune ${index + 1}`,
}))

const atEnd = (scroller: Element) =>
  scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight

it('scrolls the list while a touch drag rests at its edge, to reach rows off screen', async () => {
  const onReorder = vi.fn()
  const { frames, runUntil } = manualFrames()
  renderWithProviders(
    <div data-testid="scroller" className="h-48 overflow-y-auto">
      <Tunes onReorder={onReorder} tunes={TWELVE} frames={frames} />
    </div>,
    { density: 'touch' },
  )
  const scroller = page.getByTestId('scroller').element()
  const first = page.getByRole('row', { name: /^Tune 1$/ })
  const rect = first.element().getBoundingClientRect()
  const bottom = scroller.getBoundingClientRect().bottom
  // From the first row's center to just inside the scroller's bottom edge.
  await longPressDrag(first, bottom - 8 - (rect.top + rect.height / 2), {
    beforeLift: () => {
      runUntil(() => atEnd(scroller))
      expect(atEnd(scroller)).toBe(true)
    },
  })
  await expect.poll(() => onReorder).toHaveBeenCalledWith('t0', 11)
})

it('keeps a mouse-dragged row under the pointer while the wheel scrolls the list', async () => {
  const onReorder = vi.fn()
  // Frames that never run, so the list moves only by the scroll the test makes.
  const { frames } = manualFrames()
  renderWithProviders(
    <div data-testid="scroller" className="h-48 overflow-y-auto">
      <Tunes onReorder={onReorder} tunes={TWELVE} frames={frames} />
    </div>,
    { density: 'pointer' },
  )
  const scroller = page.getByTestId('scroller').element()
  const drag = mousePress(/^Tune 1$/)
  drag.to(10)
  await expect.element(row(/^Tune 1$/)).toHaveAttribute('data-lifted')
  scroller.scrollTop =
    row(/^Tune 1$/)
      .element()
      .getBoundingClientRect().height * 3
  // The rows the scroll carried under the pointer slide aside without the pointer moving.
  await expect
    .poll(() => new DOMMatrix(getComputedStyle(row(/^Tune 4$/).element()).transform).m42)
    .toBeLessThan(0)
  drag.drop()
  await expect.poll(() => onReorder).toHaveBeenCalledWith('t0', 3)
})

it('scrolls from the edge a bar over the list leaves uncovered', async () => {
  const onReorder = vi.fn()
  const { frames, runUntil } = manualFrames()
  renderWithProviders(
    <>
      {/* Padded at the end as a screen under a bar is, so its last row can show above it. */}
      <div data-testid="scroller" className="h-72 overflow-y-auto pb-24">
        <Tunes onReorder={onReorder} tunes={TWELVE} frames={frames} />
      </div>
      <div data-testid="bar" className="bg-ground fixed inset-x-0 top-48 h-24" />
    </>,
    { density: 'touch' },
  )
  const scroller = page.getByTestId('scroller').element()
  const barTop = page.getByTestId('bar').element().getBoundingClientRect().top
  const first = page.getByRole('row', { name: /^Tune 1$/ })
  const rect = first.element().getBoundingClientRect()
  // Just above the bar, which hides the scroller's own bottom edge.
  await longPressDrag(first, barTop - 8 - (rect.top + rect.height / 2), {
    beforeLift: () => {
      runUntil(() => atEnd(scroller))
      expect(atEnd(scroller)).toBe(true)
    },
  })
  await expect.poll(() => onReorder).toHaveBeenCalledWith('t0', 11)
})

it('scrolls nowhere while a bar covers nearly all of the list', async () => {
  const { frames, runUntil } = manualFrames()
  renderWithProviders(
    <>
      <div data-testid="scroller" className="h-72 overflow-y-auto">
        <Tunes onReorder={vi.fn()} tunes={TWELVE} frames={frames} />
      </div>
      <div data-testid="overlay" className="bg-ground fixed inset-x-0 top-0 h-56" />
    </>,
    { density: 'touch' },
  )
  const scroller = page.getByTestId('scroller').element()
  const overlayBottom = page.getByTestId('overlay').element().getBoundingClientRect().bottom
  const strip = { top: overlayBottom, bottom: scroller.getBoundingClientRect().bottom }
  const middle = (row: Element) => {
    const box = row.getBoundingClientRect()
    return box.top + box.height / 2
  }
  // A row the finger can reach: its center lies in the strip the overlay leaves.
  const index = page
    .getByRole('row')
    .elements()
    .findIndex((row) => middle(row) > strip.top && middle(row) < strip.bottom)
  expect(index).toBeGreaterThanOrEqual(0)
  const last = page.getByRole('row').nth(index)
  const rect = last.element().getBoundingClientRect()
  // Across the strip the overlay leaves, which is too thin for either edge zone.
  const from = rect.top + rect.height / 2
  const dy = (from > (strip.top + strip.bottom) / 2 ? strip.top + 4 : strip.bottom - 4) - from
  await longPressDrag(last, dy, {
    beforeLift: () => {
      expect(last.element()).toHaveAttribute('data-reordering')
      runUntil(() => scroller.scrollTop !== 0, 50)
      expect(scroller.scrollTop).toBe(0)
    },
  })
})

it('lands a tall row at either end among shorter rows', async () => {
  const onReorder = vi.fn()
  const tunes = TUNES.map((tune) => ({ ...tune, tall: tune.id === 'b' }))
  renderWithProviders(<Tunes onReorder={onReorder} tunes={tunes} />, { density: 'touch' })
  const tall = page.getByRole('row', { name: /Angeline the Baker/ })
  await expect
    .poll(() => tall.element().getBoundingClientRect().height)
    .toBeGreaterThan(rowHeight())
  await longPressDrag(tall, rowHeight() * 6)
  await expect.poll(() => onReorder).toHaveBeenLastCalledWith('b', 3)
  await expect.poll(() => shownTitles()[3]).toBe('Angeline the Baker')
  await longPressDrag(tall, -rowHeight() * 6)
  await expect.poll(() => onReorder).toHaveBeenLastCalledWith('b', 0)
})

it('reorders once a list that rendered before it could gets its onReorder', async () => {
  const onReorder = vi.fn()
  const { rerender } = renderWithProviders(<Tunes onReorder={onReorder} loading />, {
    density: 'touch',
  })
  expect(page.getByRole('button', { name: moveRowLabel('Forked Deer') }).query()).toBeNull()
  rerender(<Tunes onReorder={onReorder} />)
  await expect
    .element(page.getByRole('button', { name: moveRowLabel('Forked Deer') }))
    .toBeInTheDocument()
  await longPressDrag(page.getByRole('row', { name: /Forked Deer/ }), rowHeight() * 2.5)
  await expect.poll(() => onReorder).toHaveBeenCalledWith('a', 2)
})
