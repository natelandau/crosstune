import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { cdp, page, userEvent } from 'vitest/browser'
import { afterAll, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { drag, dragDown } from '../test/gestures'
import { renderWithProviders } from '../test/render'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { releaseTarget, SHEET } from './sheetGeometry'
import { seen } from '../test/events'

// The geometry below assumes the phone viewport, which a pointer test widens.
beforeEach(async () => {
  await page.viewport(390, 844)
})

afterAll(async () => {
  await page.viewport(390, 844)
})

function Harness({
  locked = false,
  height,
  primary = true,
  onOpenChange,
  onClosed,
}: {
  locked?: boolean
  height?: 'part' | 'full'
  primary?: boolean
  onOpenChange?: (open: boolean) => void
  onClosed?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button label="Edit tune" onPress={() => setOpen(true)} />
      <Sheet
        isOpen={open}
        onOpenChange={(next) => {
          onOpenChange?.(next)
          setOpen(next)
        }}
        onClosed={onClosed}
        title="Edit tune"
        height={height}
        locked={locked}
        primary={primary ? { label: 'Save', onPress: () => setOpen(false) } : undefined}
      >
        <input aria-label="Title" />
      </Sheet>
    </>
  )
}

const dialog = () => page.getByRole('dialog', { name: 'Edit tune' })

/** The sheet's top edge, relative to the viewport top. */
function sheetTop(): number {
  return dialog().element().getBoundingClientRect().top
}

async function open(): Promise<void> {
  await page.getByRole('button', { name: 'Edit tune' }).click()
  await expect.element(dialog()).toBeVisible()
}

/** Opens a touch sheet and waits for it to settle at part height, where a finger can reach it. */
async function openSettled(): Promise<void> {
  await open()
  await expect.poll(sheetTop).toBe(844 / 2)
}

/** Reads `read` once a frame until `until` settles, and returns every value read. */
async function everyFrame<T>(read: () => T, until: () => Promise<unknown>): Promise<T[]> {
  const values: T[] = []
  let running = true
  const tick = () => {
    if (!running) return
    values.push(read())
    requestAnimationFrame(tick)
  }
  tick()
  try {
    await until()
  } finally {
    running = false
  }
  return values
}

/** Clicks the backdrop near the top of the window, clear of a sheet or a centered dialog. */
async function clickBackdrop(): Promise<void> {
  const scrim = document.querySelector('[data-sheet-scrim]')
  if (!scrim) throw new Error('no sheet scrim')
  await userEvent.click(page.elementLocator(scrim), { position: { x: 20, y: 10 } })
}

it.each(['touch', 'pointer'] as const)(
  'a locked %s sheet refuses Escape and keeps typed work',
  async (density) => {
    const onOpenChange = vi.fn()
    renderWithProviders(<Harness locked onOpenChange={onOpenChange} />, { density })
    await open()
    await page.getByRole('textbox', { name: 'Title' }).fill("Soldier's Joy")
    const escapes = seen('keyup', (event) => (event as KeyboardEvent).key === 'Escape')
    await userEvent.keyboard('{Escape}')
    await expect.poll(escapes).toBe(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await expect.element(dialog()).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue("Soldier's Joy")
  },
)

it.each(['touch', 'pointer'] as const)(
  'a locked %s sheet refuses a backdrop tap',
  async (density) => {
    const onOpenChange = vi.fn()
    renderWithProviders(<Harness locked onOpenChange={onOpenChange} />, { density })
    await open()
    await page.getByRole('textbox', { name: 'Title' }).fill("Soldier's Joy")
    const clicks = seen('click')
    await clickBackdrop()
    await expect.poll(clicks).toBe(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await expect.element(dialog()).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue("Soldier's Joy")
  },
)

it.each(['touch', 'pointer'] as const)(
  'a %s sheet reports once that it has closed, and never while mounted closed',
  async (density) => {
    const onClosed = vi.fn()
    renderWithProviders(<Harness onClosed={onClosed} />, { density })
    await expect.element(page.getByRole('button', { name: 'Edit tune' })).toBeVisible()
    expect(onClosed).not.toHaveBeenCalled()
    await open()
    expect(onClosed).not.toHaveBeenCalled()
    await dialog().getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => onClosed.mock.calls.length).toBe(1)
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(onClosed).toHaveBeenCalledOnce()
  },
)

it.each(['touch', 'pointer'] as const)(
  'an open %s sheet closes on a backdrop tap',
  async (density) => {
    renderWithProviders(<Harness />, { density })
    await open()
    await clickBackdrop()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  },
)

it('an open sheet closes on Escape', async () => {
  renderWithProviders(<Harness />, { density: 'touch' })
  await open()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('a locked touch sheet refuses a drag down', async () => {
  const onOpenChange = vi.fn()
  renderWithProviders(<Harness locked onOpenChange={onOpenChange} />, { density: 'touch' })
  await openSettled()
  await dragDown(page.getByRole('dialog', { name: 'Edit tune' }), 400)
  await expect.element(page.getByRole('dialog', { name: 'Edit tune' })).toBeVisible()
  // Settling back at part height proves the release ran and chose to stay.
  await expect.poll(sheetTop).toBe(844 / 2)
  expect(onOpenChange).not.toHaveBeenCalledWith(false)
})

it('an open touch sheet closes on a drag down', async () => {
  renderWithProviders(<Harness />, { density: 'touch' })
  await openSettled()
  await dragDown(dialog(), 400)
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('a part-height sheet opens to half the window and drags up to full', async () => {
  renderWithProviders(<Harness />, { density: 'touch' })
  await openSettled()
  await drag(page.getByRole('heading', { name: 'Edit tune' }), 0, -300)
  await expect.poll(sheetTop).toBe(34)
})

it('a full-height sheet opens full', async () => {
  renderWithProviders(<Harness height="full" />, { density: 'touch' })
  await open()
  await expect.poll(sheetTop).toBe(34)
})

it('Cancel closes and returns focus to the opener', async () => {
  renderWithProviders(<Harness locked />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Edit tune' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Edit tune' })).toHaveFocus()
})

it('Cancel closes a locked touch sheet', async () => {
  renderWithProviders(<Harness locked />, { density: 'touch' })
  await open()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Edit tune' })).toHaveFocus()
})

it('runs the primary from the header, and shows Cancel alone without one', async () => {
  const onPress = vi.fn()
  const { rerender } = renderWithProviders(
    <Sheet isOpen onOpenChange={() => {}} title="Edit tune" primary={{ label: 'Save', onPress }}>
      <p>Body</p>
    </Sheet>,
    { density: 'pointer' },
  )
  await page.getByRole('button', { name: 'Save' }).click()
  expect(onPress).toHaveBeenCalledOnce()
  rerender(
    <Sheet isOpen onOpenChange={() => {}} title="Edit tune" cancelLabel="Close">
      <p>Body</p>
    </Sheet>,
  )
  await expect.element(page.getByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Close' })).toBeVisible()
})

it('is a 480px dialog on pointer', async () => {
  await page.viewport(1280, 800)
  renderWithProviders(<Harness />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Edit tune' }).click()
  await expect
    .poll(
      () => page.getByRole('dialog', { name: 'Edit tune' }).element().getBoundingClientRect().width,
    )
    .toBe(480)
})

it('keeps a 16px gutter on a narrow pointer window', async () => {
  renderWithProviders(<Harness />, { density: 'pointer' })
  await open()
  await expect.poll(() => dialog().element().getBoundingClientRect().width).toBe(390 - 32)
})

it('recedes the page behind a touch sheet and restores it on close', async () => {
  renderWithProviders(
    <div data-sheet-root>
      <Harness />
    </div>,
    { density: 'touch' },
  )
  const root = document.querySelector<HTMLElement>('[data-sheet-root]')!
  await open()
  await expect.poll(() => root.style.transform).toContain('scale')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(root.getAttribute('style') ?? '').toBe('')
  expect(document.body.getAttribute('style') ?? '').toBe('')
})

it('restores the receded page when the sheet unmounts open', async () => {
  const { rerender } = renderWithProviders(
    <div data-sheet-root>
      <Sheet isOpen onOpenChange={() => {}} title="Edit tune">
        <p>Body</p>
      </Sheet>
    </div>,
    { density: 'touch' },
  )
  const root = document.querySelector<HTMLElement>('[data-sheet-root]')!
  await expect.poll(() => root.style.transform).toContain('scale')
  rerender(<div data-sheet-root />)
  await expect.poll(() => root.getAttribute('style') ?? '').toBe('')
  expect(document.body.getAttribute('style') ?? '').toBe('')
})

// The spike's cases at 390x844: full 0, part 388, closed 810.
it.each([
  ['a slow drag up from part goes full', 88, -236, 0],
  ['a short slow drag down from full stays full', 150, 100, 0],
  ['a longer slow drag down from full goes to part', 200, 100, 388],
  ['a slow drag down from part short of the midpoint stays part', 588, 100, 388],
  ['a slow drag down from part past the midpoint closes', 618, 100, 810],
  ['a flick up from part goes full though part is nearer', 238, -1006, 0],
  ['a flick down from full stops at part', 100, 668, 388],
  ['a flick down from part closes', 508, 801, 810],
])('%s', (_, at, velocity, target) => {
  expect(releaseTarget(at, velocity, [0, 388, 810])).toBe(target)
})

it('never releases a locked sheet past its lowest detent', () => {
  expect(releaseTarget(450, 900, [0, 388])).toBe(388)
})

it('scrolls long content instead of dragging the sheet', async () => {
  renderWithProviders(
    <Sheet isOpen onOpenChange={() => {}} title="Edit tune" height="full">
      {Array.from({ length: 60 }, (_, line) => (
        <p key={line}>Line {line + 1}</p>
      ))}
    </Sheet>,
    { density: 'touch' },
  )
  await expect.poll(sheetTop).toBe(34)
  const content = () => document.querySelector('[data-sheet-content]')!
  await expect.poll(() => getComputedStyle(content()).touchAction).toBe('pan-y')
  const tops = await everyFrame(sheetTop, async () => {
    await dragDown(page.getByText('Line 30', { exact: true }), 300)
    await expect.poll(sheetTop).toBe(34)
  })
  expect(tops.filter((top) => top !== 34)).toEqual([])
})

function Handoff() {
  const [shown, setShown] = useState<'a' | 'b' | null>(null)
  return (
    <div data-sheet-root>
      <Button label="Open A" onPress={() => setShown('a')} />
      <Sheet
        isOpen={shown === 'a'}
        onOpenChange={(open) => setShown(open ? 'a' : null)}
        title="Sheet A"
        primary={{ label: 'Next', onPress: () => setShown('b') }}
      >
        <p>A</p>
      </Sheet>
      <Sheet
        isOpen={shown === 'b'}
        onOpenChange={(open) => setShown(open ? 'b' : null)}
        title="Sheet B"
      >
        <p>B</p>
      </Sheet>
    </div>
  )
}

it('restores the page when one sheet opens as another closes', async () => {
  renderWithProviders(<Handoff />, { density: 'touch' })
  const root = document.querySelector<HTMLElement>('[data-sheet-root]')!
  await page.getByRole('button', { name: 'Open A' }).click()
  await expect.poll(() => root.style.transform).toContain('scale')
  const transforms = await everyFrame(
    () => root.style.transform,
    async () => {
      await page.getByRole('button', { name: 'Next' }).click()
      await expect.element(page.getByRole('dialog', { name: 'Sheet B' })).toBeVisible()
      await expect.element(page.getByRole('dialog', { name: 'Sheet A' })).not.toBeInTheDocument()
    },
  )
  // The page never springs back flat between the two.
  expect(transforms.filter((t) => t.includes('scale(1)'))).toEqual([])
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.poll(() => root.getAttribute('style') ?? '').toBe('')
  expect(document.body.getAttribute('style') ?? '').toBe('')
})

it('opens a touch sheet in place under reduced motion', async () => {
  renderWithProviders(
    <MotionConfig reducedMotion="always">
      <Harness />
    </MotionConfig>,
    { density: 'touch' },
  )
  const tops = await everyFrame(
    () => dialog().query()?.getBoundingClientRect().top,
    async () => {
      await page.getByRole('button', { name: 'Edit tune' }).click()
      await expect.poll(sheetTop).toBe(844 / 2)
    },
  )
  expect(tops.filter((top) => top !== undefined && top !== 844 / 2)).toEqual([])
})

it('opens a pointer dialog without scaling under reduced motion', async () => {
  renderWithProviders(
    <MotionConfig reducedMotion="always">
      <Harness />
    </MotionConfig>,
    { density: 'pointer' },
  )
  const surface = () => document.querySelector('[data-sheet-scrim] > *')
  const transforms = await everyFrame(
    () => {
      const element = surface()
      return element && getComputedStyle(element).transform
    },
    async () => {
      await page.getByRole('button', { name: 'Edit tune' }).click()
      await expect.poll(() => getComputedStyle(surface()!.firstElementChild!).opacity).toBe('1')
      await expect.poll(() => getComputedStyle(surface()!).opacity).toBe('1')
    },
  )
  expect(transforms.filter((t) => t !== null && t !== 'none')).toEqual([])
})

it('settles a released touch sheet without a spring under reduced motion', async () => {
  renderWithProviders(
    <MotionConfig reducedMotion="always">
      <Harness />
    </MotionConfig>,
    { density: 'touch' },
  )
  await openSettled()
  const modal = dialog().element().parentElement!
  const tops: number[] = []
  const observer = new MutationObserver(() => tops.push(sheetTop()))
  try {
    await drag(page.getByRole('heading', { name: 'Edit tune' }), 0, -300)
    // Released above part height: every frame from here on is the settle, not the drag.
    observer.observe(modal, { attributes: true, attributeFilter: ['style'] })
    await expect.poll(sheetTop).toBe(34)
  } finally {
    observer.disconnect()
  }
  expect(tops.filter((top) => top !== 34)).toEqual([])
})

it('goes back up when its parent refuses a closing drag', async () => {
  const onOpenChange = vi.fn()
  renderWithProviders(
    <Sheet isOpen onOpenChange={onOpenChange} title="Edit tune">
      <p>Body</p>
    </Sheet>,
    { density: 'touch' },
  )
  await expect.poll(sheetTop).toBe(844 / 2)
  await dragDown(dialog(), 400)
  await expect.poll(() => onOpenChange).toHaveBeenCalledWith(false)
  await expect.poll(sheetTop).toBe(844 / 2)
})

/** Records the sheet's top on every style change, so a test can read the path it took. */
function recordTops(): { tops: number[]; stop: () => void } {
  const tops: number[] = []
  const observer = new MutationObserver(() => tops.push(sheetTop()))
  observer.observe(dialog().element().parentElement!, {
    attributes: true,
    attributeFilter: ['style'],
  })
  return { tops, stop: () => observer.disconnect() }
}

it('never springs back when its parent closes after the close window opens', async () => {
  const asked = vi.fn()
  let answer: () => void = () => {}
  const answered = new Promise<void>((resolve) => {
    answer = resolve
  })
  function AsyncParent() {
    const [open, setOpen] = useState(true)
    return (
      <Sheet
        isOpen={open}
        onOpenChange={(next) => {
          asked(next)
          void answered.then(() => setOpen(false))
        }}
        title="Edit tune"
      >
        <p>Body</p>
      </Sheet>
    )
  }
  renderWithProviders(<AsyncParent />, { density: 'touch' })
  await expect.poll(sheetTop).toBe(844 / 2)
  const { tops, stop } = recordTops()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await dragDown(dialog(), 400)
    const pending = vi.getTimerCount()
    await expect.poll(() => asked).toHaveBeenCalledWith(false)
    // The close window starts in an effect after React commits the release.
    await expect.poll(() => vi.getTimerCount()).toBeGreaterThan(pending)
    const releasedAt = sheetTop()
    const from = tops.length
    await vi.advanceTimersByTimeAsync(SHEET.closeAnswerMs - 1)
    // The parent has not answered and the window has not passed: the sheet stays where released.
    expect(releasedAt).toBeGreaterThan(844 / 2 + 100)
    expect(sheetTop()).toBeGreaterThan(releasedAt - 5)
    answer()
    // The exit has begun, so the parent's answer has rendered and cancelled the pending return.
    await expect.poll(sheetTop).toBeGreaterThan(releasedAt + 2)
    await vi.advanceTimersByTimeAsync(SHEET.closeAnswerMs)
    await expect.poll(() => dialog().query()).toBeNull()
    // The exit eases off the release point by a pixel or two; a return to the detent drops far more.
    expect(Math.min(...tops.slice(from))).toBeGreaterThan(releasedAt - 5)
  } finally {
    stop()
    vi.useRealTimers()
  }
})

it('goes back up once the close window passes with no answer', async () => {
  const onOpenChange = vi.fn()
  renderWithProviders(
    <Sheet isOpen onOpenChange={onOpenChange} title="Edit tune">
      <p>Body</p>
    </Sheet>,
    { density: 'touch' },
  )
  await expect.poll(sheetTop).toBe(844 / 2)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await dragDown(dialog(), 400)
    // The drag's end handler has run, and the close window it asks for starts in an effect
    // after React commits, so the clock may only advance once that timer exists.
    const pending = vi.getTimerCount()
    await expect.poll(() => onOpenChange).toHaveBeenCalledWith(false)
    await expect.poll(() => vi.getTimerCount()).toBeGreaterThan(pending)
    await vi.advanceTimersByTimeAsync(SHEET.closeAnswerMs - 1)
    expect(sheetTop()).toBeGreaterThan(844 / 2 + 100)
    await vi.advanceTimersByTimeAsync(1)
  } finally {
    vi.useRealTimers()
  }
  await expect.poll(sheetTop).toBe(844 / 2)
})

it.each(['touch', 'pointer'] as const)(
  'darkens the backdrop to one scrim on %s',
  async (density) => {
    renderWithProviders(<Harness height="full" />, { density })
    await open()
    const scrim = () =>
      getComputedStyle(document.querySelector('[data-sheet-scrim]')!).backgroundColor
    await expect.poll(scrim).toBe('rgba(0, 0, 0, 0.4)')
  },
)

it("keeps a touch sheet's header and content clear of the side safe areas", async () => {
  await cdp().send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 40, right: 30 } })
  onTestFinished(async () => {
    await cdp().send('Emulation.setSafeAreaInsetsOverride', { insets: {} })
  })
  renderWithProviders(<Harness />, { density: 'touch' })
  await openSettled()
  const cancel = page.getByRole('button', { name: 'Cancel' })
  const save = page.getByRole('button', { name: 'Save' })
  const field = page.getByRole('textbox', { name: 'Title' })
  await expect.poll(() => cancel.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(40)
  expect(save.element().getBoundingClientRect().right).toBeLessThanOrEqual(390 - 30)
  expect(field.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(40)
})

it('stays at full height when the window turns', async () => {
  renderWithProviders(<Harness />, { density: 'touch' })
  await openSettled()
  await drag(page.getByRole('heading', { name: 'Edit tune' }), 0, -300)
  await expect.poll(sheetTop).toBe(34)
  await page.viewport(844, 390)
  await expect.poll(() => window.innerHeight).toBe(390)
  await expect.poll(sheetTop).toBe(34)
})

it('keeps the page receded when a sheet under another leaves', async () => {
  function Stack({ under }: { under: boolean }) {
    return (
      <div data-sheet-root>
        {under && (
          <Sheet isOpen onOpenChange={() => {}} title="Under">
            <p>Under</p>
          </Sheet>
        )}
        <Sheet isOpen onOpenChange={() => {}} title="Over" height="full">
          <p>Over</p>
        </Sheet>
      </div>
    )
  }
  const { rerender } = renderWithProviders(<Stack under />, { density: 'touch' })
  const root = document.querySelector<HTMLElement>('[data-sheet-root]')!
  await expect
    .poll(() => page.getByRole('dialog', { name: 'Over' }).element().getBoundingClientRect().top)
    .toBe(34)
  await expect.poll(() => root.style.transform).toMatch(/translateY\(20px\)/)
  const full = root.style.transform
  rerender(<Stack under={false} />)
  await expect.poll(() => page.getByRole('dialog', { name: 'Under' }).query()).toBeNull()
  expect(root.style.transform).toBe(full)
  rerender(<div data-sheet-root />)
  await expect.poll(() => root.getAttribute('style') ?? '').toBe('')
})
