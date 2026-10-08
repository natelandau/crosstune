import { Inbox } from 'lucide-react'
import { act } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import type { ReactElement } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderHookWithProviders, renderWithProviders } from '../test/render'
import { Capsule } from './Capsule'
import { EmptyState } from './EmptyState'
import { FilterRow } from './FilterRow'
import { ListHeader } from './ListHeader'
import { Menu, type MenuTriggerProps } from './Menu'
import { Sheet } from './Sheet'
import { ToastProvider, UNDO, useToast } from './Toast'
import { FILTERS } from './filterCopy'
import { A_TO_Z, SORT, SORT_BY, Z_TO_A } from './sortCopy'

// A real click in an earlier test leaves the pointer where a toast later appears, and a toast
// under the pointer holds open by design.
beforeEach(async () => {
  await userEvent.unhover(document.body)
})

const CLEAR = 'rgba\\(0, 0, 0, 0\\)'
const BLACK_FIRST = new RegExp(`^linear-gradient\\(to right, rgb\\(0, 0, 0\\).*${CLEAR}`)
const CLEAR_FIRST = new RegExp(`^linear-gradient\\(to right, ${CLEAR}`)
const BLACK_LAST = /rgb\(0, 0, 0\)[^,]*\)$/

const CAPSULES = [
  'Key: Any',
  'Type: Any',
  'Tuning: Any',
  'Genre: old-time',
  'Composer: Traditional',
]

it('shows one toast at a time and hides it after 8 seconds', async () => {
  vi.useFakeTimers()
  try {
    const { result } = renderHookWithProviders(() => useToast())
    act(() => result.current.show('Archived 3 tunes', () => {}))
    act(() => result.current.show('Archived 1 tune', () => {}))
    await expect.element(page.getByText('Archived 1 tune')).toBeVisible()
    await expect.poll(() => page.getByText('Archived 3 tunes').elements()).toHaveLength(0)
    act(() => vi.advanceTimersByTime(8000))
    await expect.element(page.getByText('Archived 1 tune')).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

function ShowToast({ undo }: { undo?: () => void }) {
  const { show } = useToast()
  return <button onClick={() => show('Archived 3 tunes', undo)}>Archive</button>
}

it('runs Undo and dismisses the toast', async () => {
  const undo = vi.fn()
  renderWithProviders(<ShowToast undo={undo} />)
  await page.getByRole('button', { name: 'Archive' }).click()
  await expect.element(page.getByRole('status')).toHaveTextContent('Archived 3 tunes')
  await page.getByRole('button', { name: UNDO }).click()
  await expect.poll(() => undo.mock.calls.length).toBe(1)
  await expect.element(page.getByText('Archived 3 tunes')).not.toBeInTheDocument()
})

it('has no Undo button when none is given', async () => {
  renderWithProviders(<ShowToast />)
  await page.getByRole('button', { name: 'Archive' }).click()
  await expect.element(page.getByText('Archived 3 tunes')).toBeVisible()
  expect(page.getByRole('button', { name: UNDO }).elements()).toHaveLength(0)
})

/** A clock that moves only when told, so the countdown arithmetic is exact. */
function manualClock() {
  let time = 0
  let nextHandle = 1
  const pending = new Map<number, { at: number; callback: () => void }>()
  return {
    now: () => time,
    setTimeout: (callback: () => void, ms: number) => {
      pending.set(nextHandle, { at: time + ms, callback })
      return nextHandle++
    },
    clearTimeout: (handle: number) => void pending.delete(handle),
    advance(ms: number) {
      time += ms
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= time) {
          pending.delete(handle)
          timer.callback()
        }
      }
    },
  }
}

async function pausedThenResumed(
  hold: (el: HTMLElement) => void,
  release: (el: HTMLElement) => void,
) {
  const clock = manualClock()
  const tick = (ms: number) => act(() => clock.advance(ms))
  renderWithProviders(
    <ToastProvider clock={clock}>
      <ShowToast undo={() => {}} />
    </ToastProvider>,
  )
  await userEvent.click(page.getByRole('button', { name: 'Archive' }))
  await expect.element(page.getByRole('button', { name: UNDO })).toBeVisible()
  const toast = page.getByRole('button', { name: UNDO }).element().parentElement as HTMLElement
  tick(5000)
  hold(toast)
  tick(20000)
  // A dismissed toast keeps fading in real time, so being visible is not enough.
  expect(toast).not.toHaveAttribute('data-leaving')
  release(toast)
  tick(2999)
  expect(toast).not.toHaveAttribute('data-leaving')
  tick(1)
  await expect.element(page.getByText('Archived 3 tunes')).not.toBeInTheDocument()
}

it('resumes what is left of the countdown after keyboard focus leaves', async () => {
  const undo = () => page.getByRole('button', { name: UNDO }).element() as HTMLElement
  await pausedThenResumed(
    () => act(() => undo().focus()),
    () => act(() => undo().blur()),
  )
})

it('resumes what is left of the countdown after the pointer leaves', async () => {
  await pausedThenResumed(
    (el) => act(() => void el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))),
    (el) => act(() => void el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))),
  )
})

it('returns focus to where it was when keyboard Undo dismisses the toast', async () => {
  renderWithProviders(<ShowToast undo={() => {}} />)
  const archive = page.getByRole('button', { name: 'Archive' })
  await userEvent.click(archive)
  await expect.element(page.getByRole('button', { name: UNDO })).toBeVisible()
  ;(archive.element() as HTMLElement).focus()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: UNDO })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(archive).toHaveFocus()
})

it('keeps a toast visible, clickable, and exposed above an open sheet', async () => {
  const undo = vi.fn()
  function Over() {
    const { show } = useToast()
    return (
      <Sheet isOpen onOpenChange={() => {}} title="Edit tune">
        <button onClick={() => show('Archived 3 tunes', undo)}>Archive</button>
      </Sheet>
    )
  }
  renderWithProviders(<Over />)
  await userEvent.click(page.getByRole('button', { name: 'Archive' }))
  await expect.element(page.getByText('Archived 3 tunes')).toBeVisible()
  const toast = page.getByText('Archived 3 tunes').element()
  expect(toast.closest('[aria-hidden="true"]')).toBeNull()
  // Clicking Undo proves no modal backdrop sits over the toast.
  await userEvent.click(page.getByRole('button', { name: UNDO }))
  await expect.poll(() => undo.mock.calls.length).toBe(1)
})

it('scrolls on touch and wraps on pointer', async () => {
  renderWithProviders(
    <FilterRow label={FILTERS}>
      {CAPSULES.map((l) => (
        <Capsule key={l} label={l} />
      ))}
    </FilterRow>,
    { density: 'touch' },
  )
  const row = page.getByRole('group', { name: FILTERS }).element()
  await expect.poll(() => row.scrollWidth > row.clientWidth).toBe(true)
  document.documentElement.dataset.density = 'pointer'
  await expect.poll(() => row.scrollWidth > row.clientWidth).toBe(false)
})

it('fades the trailing edge only while more remains', async () => {
  renderWithProviders(
    <FilterRow label={FILTERS}>
      {CAPSULES.map((l) => (
        <Capsule key={l} label={l} />
      ))}
    </FilterRow>,
    { density: 'touch' },
  )
  const row = page.getByRole('group', { name: FILTERS }).element()
  await expect.poll(() => getComputedStyle(row).maskImage).toMatch(BLACK_FIRST)
  act(() => {
    row.scrollLeft = row.scrollWidth
  })
  await expect.poll(() => getComputedStyle(row).maskImage).toMatch(CLEAR_FIRST)
  expect(getComputedStyle(row).maskImage).toMatch(BLACK_LAST)
})

it('scrolls a capsule that becomes set into view', async () => {
  function Row({ set }: { set: boolean }) {
    return (
      <FilterRow label={FILTERS}>
        {CAPSULES.map((l) => (
          <Capsule key={l} label={l} set={set && l === 'Composer: Traditional'} />
        ))}
      </FilterRow>
    )
  }
  const { rerender } = renderWithProviders(<Row set={false} />, { density: 'touch' })
  const row = page.getByRole('group', { name: FILTERS }).element()
  await expect.poll(() => row.scrollWidth > row.clientWidth).toBe(true)
  expect(row.scrollLeft).toBe(0)
  rerender(<Row set />)
  await expect.poll(() => row.scrollLeft).toBeGreaterThan(0)
})

it.each([
  ['mounts with', true],
  ['comes to have', false],
])('leaves the page scroll alone when a row %s a set filter', async (_, setOnMount) => {
  // Reduced motion makes every scroll instant, so each read below is of a settled position.
  function Page({ set }: { set: boolean }) {
    return (
      <MotionConfig reducedMotion="always">
        <div className="h-[2000px]" />
        <FilterRow label={FILTERS}>
          {CAPSULES.map((l) => (
            <Capsule key={l} label={l} set={set && l === 'Composer: Traditional'} />
          ))}
        </FilterRow>
      </MotionConfig>
    )
  }
  const { rerender } = renderWithProviders(<Page set={setOnMount} />, { density: 'touch' })
  const row = page.getByRole('group', { name: FILTERS }).element()
  await expect.poll(() => row.scrollWidth > row.clientWidth).toBe(true)
  if (setOnMount) {
    // The mount has run its effects once the mask reflects the measured overflow.
    await expect.poll(() => getComputedStyle(row).maskImage).toMatch(BLACK_FIRST)
    expect(row.scrollLeft).toBe(0)
  } else {
    rerender(<Page set />)
    await expect.poll(() => row.scrollLeft).toBeGreaterThan(0)
  }
  expect(window.scrollY).toBe(0)
})

it('names the sort with its direction in words', async () => {
  renderWithProviders(
    <ListHeader
      count="11 of 84 tunes"
      sort={{
        label: 'Title',
        ascending: true,
        spoken: `${SORT_BY} Title, ${A_TO_Z}`,
        menu: (trigger) => trigger,
      }}
    />,
  )
  await expect
    .element(page.getByRole('button', { name: `${SORT_BY} Title, ${A_TO_Z}` }))
    .toBeVisible()
  await expect.element(page.getByText('11 of 84 tunes')).toBeVisible()
})

it('hides the sort when there is none', async () => {
  renderWithProviders(<ListHeader count="3 tunes" />)
  await expect.element(page.getByText('3 tunes')).toBeVisible()
  expect(page.getByRole('button').elements()).toHaveLength(0)
})

function SortMenu({ trigger }: { trigger: ReactElement<MenuTriggerProps> }) {
  return (
    <Menu
      label={SORT}
      trigger={trigger}
      items={[{ id: 'title', label: 'Title', icon: Inbox, onAction() {} }]}
    />
  )
}

it('opens the sort menu from the sort button', async () => {
  renderWithProviders(
    <ListHeader
      count="3 tunes"
      sort={{
        label: 'Title',
        ascending: false,
        spoken: `${SORT_BY} Title, ${Z_TO_A}`,
        // Wrapped in a component of the caller's, as a screen's own sort menu would be.
        menu: (trigger) => <SortMenu trigger={trigger} />,
      }}
    />,
  )
  await userEvent.click(page.getByRole('button', { name: `${SORT_BY} Title, ${Z_TO_A}` }))
  await expect.element(page.getByRole('menuitem', { name: 'Title' })).toBeVisible()
})

it('centers an empty state with its hint and action', async () => {
  renderWithProviders(
    <EmptyState
      icon={Inbox}
      title="No tunes yet"
      hint="Add one to get started."
      action={<button>Add tune</button>}
    />,
  )
  await expect.element(page.getByRole('heading', { name: 'No tunes yet', level: 2 })).toBeVisible()
  await expect.element(page.getByText('Add one to get started.')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Add tune' })).toBeVisible()
})

it('heads an empty state at the level asked for', async () => {
  renderWithProviders(<EmptyState icon={Inbox} title="No recordings" headingLevel={3} />)
  await expect.element(page.getByRole('heading', { name: 'No recordings', level: 3 })).toBeVisible()
})
