import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLICK_GUARD_MS } from './swipe'
import { SwipeRow, type SwipeAction } from './SwipeRow'

// The clock the row reads to measure release speed, advanced by each move.
let now = 0

beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(async () => {
  vi.restoreAllMocks()
  // A swipe's click guard outlives the gesture briefly and would swallow the next test's click.
  await waitOutClickGuard()
})

const waitOutClickGuard = () => new Promise((resolve) => setTimeout(resolve, CLICK_GUARD_MS + 10))

function renderRow({ open = false }: { open?: boolean } = {}) {
  const onOpenChange = vi.fn()
  const onSwipeStart = vi.fn()
  const onLink = vi.fn()
  const actions: [SwipeAction, SwipeAction] = [
    { label: 'Edit', tone: 'neutral', onPress: vi.fn() },
    { label: 'Archive', tone: 'warning', onPress: vi.fn() },
  ]
  render(
    <SwipeRow
      name="Soldier's Joy"
      actions={actions}
      open={open}
      otherOpen={false}
      onOpenChange={onOpenChange}
      onSwipeStart={onSwipeStart}
      closeOpenRow={vi.fn()}
    >
      <a
        href="#song"
        onClick={(event) => {
          event.preventDefault()
          onLink()
        }}
      >
        Soldier's Joy
      </a>
    </SwipeRow>,
  )
  return { onOpenChange, onSwipeStart, onLink, link: screen.getByRole('link') }
}

const START_X = 300

function press(target: Element, { isPrimary = true, pointerId = 1 } = {}) {
  fireEvent.pointerDown(target, { clientX: START_X, clientY: 100, isPrimary, button: 0, pointerId })
}

/**
 * Move the pointer to an offset from where it went down, `ms` after the previous move.
 * dnd-kit spends the move that crosses the activation distance on starting the drag, so a
 * gesture needs a move past 10px before any move the row follows.
 */
function moveTo(dx: number, { dy = 0, ms = 100, pointerId = 1 } = {}) {
  now += ms
  act(() => {
    fireEvent.pointerMove(document, {
      clientX: START_X + dx,
      clientY: 100 + dy,
      isPrimary: true,
      pointerId,
    })
  })
}

function release() {
  act(() => {
    fireEvent.pointerUp(document, { isPrimary: true, button: 0, pointerId: 1 })
  })
}

const actionLayer = () => screen.getByRole('button', { name: "Edit Soldier's Joy" }).parentElement

describe('SwipeRow gestures', () => {
  it('opens after a sideways swipe past half the reveal width', () => {
    const { onOpenChange, onSwipeStart, link } = renderRow()
    press(link)
    moveTo(-20)
    moveTo(-80)
    moveTo(-120)
    expect(onSwipeStart).toHaveBeenCalledTimes(1)
    release()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('settles closed after a short, slow swipe', () => {
    const { onOpenChange, link } = renderRow()
    press(link)
    moveTo(-20)
    moveTo(-50)
    release()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens on a fast flick that travels less than half', () => {
    const { onOpenChange, link } = renderRow()
    press(link)
    moveTo(-15, { ms: 10 })
    moveTo(-25, { ms: 10 })
    moveTo(-45, { ms: 20 })
    release()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('settles closed when a short flick pauses before release', () => {
    const { onOpenChange, link } = renderRow()
    press(link)
    moveTo(-15, { ms: 10 })
    moveTo(-25, { ms: 10 })
    moveTo(-45, { ms: 20 })
    now += 500
    release()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows the actions as soon as the row moves', () => {
    const { link } = renderRow()
    expect(actionLayer()).toHaveStyle({ opacity: '0' })
    press(link)
    moveTo(-20)
    moveTo(-30)
    try {
      expect(actionLayer()).toHaveStyle({ opacity: '1' })
    } finally {
      release()
    }
  })

  it('leaves a gesture that moves vertically first to page scroll', () => {
    const { onOpenChange, onSwipeStart, link } = renderRow()
    press(link)
    moveTo(-5, { dy: 20 })
    moveTo(-120, { dy: 20 })
    release()
    expect(onSwipeStart).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('follows the link after a tap that drifted short of a swipe', () => {
    const { onLink, onSwipeStart, link } = renderRow()
    press(link)
    moveTo(-6)
    release()
    fireEvent.click(link)
    expect(onSwipeStart).not.toHaveBeenCalled()
    expect(onLink).toHaveBeenCalledTimes(1)
  })

  it('swallows the click that trails a mouse swipe, default action included', () => {
    const { onLink, link } = renderRow()
    press(link)
    moveTo(-20)
    moveTo(-120)
    release()
    const notPrevented = fireEvent.click(link)
    expect(notPrevented).toBe(false)
    expect(onLink).not.toHaveBeenCalled()
  })

  it('lets a keyboard activation through once the swipe is over', async () => {
    const { onLink, link } = renderRow()
    press(link)
    moveTo(-20)
    moveTo(-120)
    release()
    await waitOutClickGuard()
    link.focus()
    await userEvent.keyboard('{Enter}')
    expect(onLink).toHaveBeenCalledTimes(1)
  })

  it('ignores a second finger landing on a row mid-swipe', () => {
    const { onOpenChange, onSwipeStart, link } = renderRow()
    press(link)
    moveTo(-20)
    press(link, { isPrimary: false, pointerId: 2 })
    moveTo(-120)
    release()
    expect(onSwipeStart).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('closes an open row swiped back to the right', () => {
    const { onOpenChange, link } = renderRow({ open: true })
    press(link)
    moveTo(20)
    moveTo(120)
    release()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
