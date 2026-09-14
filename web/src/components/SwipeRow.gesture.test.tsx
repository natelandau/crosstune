import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MotionValue, PanInfo } from 'motion/react'
import type * as MotionReactModule from 'motion/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REVEAL_WIDTH } from './swipe'
import { SwipeRow, type SwipeAction } from './SwipeRow'

type DragProps = {
  onDirectionLock: (axis: 'x' | 'y') => void
  onDragStart: () => void
  onDragEnd: (event: PointerEvent, info: PanInfo) => void
}

const gesture = vi.hoisted(() => ({ props: null as DragProps | null }))

// jsdom cannot run Motion's pointer tracking, so the tests drive its drag callbacks in the order a browser produces them.
vi.mock('motion/react-m', () => ({
  div: ({
    onPointerDownCapture,
    onClickCapture,
    className,
    children,
    ...rest
  }: ComponentProps<'div'> & DragProps) => {
    gesture.props = rest
    return (
      <div
        className={className}
        onPointerDownCapture={onPointerDownCapture}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    )
  },
}))

// jsdom can't run a real spring, so the fallback for a press that never becomes a
// drag is checked by watching what it asks Motion to animate towards, using the
// real motion value so it can be set off target the way an interrupted snap would.
const motion = vi.hoisted(() => ({
  x: null as MotionValue<number> | null,
  animate: vi.fn(),
}))

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof MotionReactModule>()
  return {
    ...actual,
    animate: motion.animate,
    useMotionValue: (initial: number) => {
      const value = actual.useMotionValue(initial)
      motion.x = value
      return value
    },
  }
})

function drag() {
  if (!gesture.props) throw new Error('SwipeRow did not render its drag layer')
  return gesture.props
}

function panInfo(velocityX: number): PanInfo {
  return {
    point: { x: 0, y: 0 },
    delta: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    velocity: { x: velocityX, y: 0 },
  }
}

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
      onOpenChange={onOpenChange}
      onSwipeStart={onSwipeStart}
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

describe('SwipeRow gestures', () => {
  beforeEach(() => {
    motion.animate.mockClear()
  })

  it('follows the link after a tap that drifted without locking to an axis', () => {
    const { onLink, onOpenChange, onSwipeStart, link } = renderRow()
    fireEvent.pointerDown(link, { isPrimary: true })
    act(() => drag().onDragStart())
    fireEvent.click(link)
    act(() => drag().onDragEnd(new PointerEvent('pointerup'), panInfo(-800)))
    expect(onSwipeStart).toHaveBeenCalledTimes(1)
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes an open row once when a drifting tap lands on it', () => {
    const { onLink, onOpenChange, link } = renderRow({ open: true })
    fireEvent.pointerDown(link, { isPrimary: true })
    act(() => drag().onDragStart())
    fireEvent.click(link)
    act(() => drag().onDragEnd(new PointerEvent('pointerup'), panInfo(0)))
    expect(onLink).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('ignores a vertical gesture when it ends', () => {
    const { onOpenChange, link } = renderRow()
    fireEvent.pointerDown(link, { isPrimary: true })
    act(() => drag().onDragStart())
    act(() => drag().onDirectionLock('y'))
    act(() => drag().onDragEnd(new PointerEvent('pointercancel'), panInfo(-800)))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('swallows the click that trails a sideways swipe and settles the row', () => {
    const { onLink, onOpenChange, link } = renderRow()
    fireEvent.pointerDown(link, { isPrimary: true })
    act(() => drag().onDragStart())
    act(() => drag().onDirectionLock('x'))
    fireEvent.click(link)
    act(() => drag().onDragEnd(new PointerEvent('pointerup'), panInfo(-800)))
    expect(onLink).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('lets a keyboard activation through after a swipe that fired no click', async () => {
    const { onLink, link } = renderRow()
    fireEvent.pointerDown(link, { isPrimary: true })
    act(() => drag().onDragStart())
    act(() => drag().onDirectionLock('x'))
    act(() => drag().onDragEnd(new PointerEvent('pointerup'), panInfo(0)))
    link.focus()
    await userEvent.keyboard('{Enter}')
    expect(onLink).toHaveBeenCalledTimes(1)
  })

  it('settles a closed row left mid-snap when a press never becomes a drag', () => {
    const { link } = renderRow({ open: false })
    motion.x?.set(-40)
    motion.animate.mockClear()
    fireEvent.pointerDown(link, { isPrimary: true })
    window.dispatchEvent(new Event('pointerup'))
    expect(motion.animate).toHaveBeenCalledTimes(1)
    expect(motion.animate).toHaveBeenCalledWith(motion.x, 0, expect.anything())
  })

  it('settles an open row left mid-snap when a press ends outside it', () => {
    const { link } = renderRow({ open: true })
    motion.animate.mockClear()
    motion.x?.set(-40)
    fireEvent.pointerDown(link, { isPrimary: true })
    // A pointercancel, dispatched on window rather than the row, stands in for a
    // release that lands outside it; Motion's own gesture listens on window too.
    window.dispatchEvent(new Event('pointercancel'))
    expect(motion.animate).toHaveBeenCalledTimes(1)
    expect(motion.animate).toHaveBeenCalledWith(motion.x, -REVEAL_WIDTH, expect.anything())
  })

  it('leaves the row for onDragEnd to settle once a drag has started', () => {
    const { link } = renderRow({ open: false })
    fireEvent.pointerDown(link, { isPrimary: true })
    act(() => drag().onDragStart())
    motion.animate.mockClear()
    window.dispatchEvent(new Event('pointerup'))
    expect(motion.animate).not.toHaveBeenCalled()
  })

  it('keeps a swipe in progress when a second finger lands on the row', () => {
    const { onOpenChange, link } = renderRow()
    fireEvent.pointerDown(link, { isPrimary: true })
    act(() => drag().onDragStart())
    act(() => drag().onDirectionLock('x'))
    fireEvent.pointerDown(link, { isPrimary: false })
    motion.animate.mockClear()
    window.dispatchEvent(new Event('pointerup'))
    expect(motion.animate).not.toHaveBeenCalled()
    act(() => drag().onDragEnd(new PointerEvent('pointerup'), panInfo(-800)))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('stops listening for the release once it has settled a press', () => {
    const { link } = renderRow({ open: false })
    motion.x?.set(-40)
    fireEvent.pointerDown(link, { isPrimary: true })
    window.dispatchEvent(new Event('pointerup'))
    motion.animate.mockClear()
    window.dispatchEvent(new Event('pointerup'))
    expect(motion.animate).not.toHaveBeenCalled()
  })
})
