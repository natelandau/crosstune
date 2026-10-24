import { act, useEffect, useRef, useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { afterAll, expect, it, vi, type Mock } from 'vitest'
import { dragDown } from '../../test/gestures'
import { renderWithProviders } from '../../test/render'
import { DONE } from '../../ui/confirmCopy'
import { FactEditor, useFactEdit } from './FactEditor'
import type { FactPatch } from './useFactWrite'

const LABEL = 'Composer'
const STORED = 'Traditional'

const FRAMES = {
  phone: { width: 390, height: 844, density: 'touch' },
  wide: { width: 1280, height: 800, density: 'pointer' },
} as const
type FrameName = keyof typeof FRAMES

afterAll(async () => {
  await page.viewport(390, 844)
})

interface Spies {
  onCommit: Mock<(patch: FactPatch) => void>
}

interface Opened extends Spies {
  /** Marks the tune gone, as a delete synced from another device would. */
  goAway: () => void
  /** Unmounts the editor with no dismissal, as browser Back or a relayout does. */
  unmount: () => void
}

function Harness({ onCommit, exposeGone }: Spies & { exposeGone: (goAway: () => void) => void }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState(false)
  const [text, setText] = useState(STORED)
  useEffect(() => exposeGone(() => setGone(true)), [exposeGone])
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Edit composer
      </button>
      <FactEditor
        label={LABEL}
        triggerRef={trigger}
        isOpen={open}
        onOpenChange={setOpen}
        stored={{ composer: STORED }}
        gone={gone}
        onCommit={onCommit}
      >
        <ComposerInput text={text} onText={setText} />
      </FactEditor>
    </>
  )
}

function ComposerInput({ text, onText }: { text: string; onText: (text: string) => void }) {
  const edit = useFactEdit()
  return (
    <input
      aria-label={LABEL}
      value={text}
      onChange={(event) => {
        onText(event.target.value)
        edit.onDraft({ composer: event.target.value })
      }}
    />
  )
}

const dialog = () => page.getByRole('dialog', { name: LABEL })
const field = () => page.getByRole('textbox', { name: LABEL })

async function openOn(frame: FrameName): Promise<Opened> {
  const { width, height, density } = FRAMES[frame]
  await page.viewport(width, height)
  const spies: Spies = { onCommit: vi.fn() }
  let goAway = () => {}
  const { unmount } = renderWithProviders(
    <Harness {...spies} exposeGone={(set) => (goAway = set)} />,
    { density },
  )
  await page.getByRole('button', { name: 'Edit composer' }).click()
  await expect.element(dialog()).toBeVisible()
  return { ...spies, goAway: () => act(goAway), unmount }
}

async function type(text: string): Promise<void> {
  await field().fill(text)
  await expect.element(field()).toHaveValue(text)
}

it('saves typed text when the popover is dismissed by a click outside', async () => {
  const { onCommit } = await openOn('wide')
  await type('Kenny Baker')
  await userEvent.click(page.elementLocator(document.body), { position: { x: 1200, y: 700 } })
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.poll(() => onCommit.mock.calls).toEqual([[{ composer: 'Kenny Baker' }]])
})

it('saves typed text on Done in the sheet', async () => {
  const { onCommit } = await openOn('phone')
  await type('Kenny Baker')
  await page.getByRole('button', { name: DONE }).click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.poll(() => onCommit.mock.calls).toEqual([[{ composer: 'Kenny Baker' }]])
})

it('saves typed text on swipe down', async () => {
  const { onCommit } = await openOn('phone')
  await type('Kenny Baker')
  // Off the field, which keeps a drag for its text, once the sheet rests at part height.
  await expect
    .poll(() => dialog().element().getBoundingClientRect().top)
    .toBe(FRAMES.phone.height / 2)
  await dragDown(page.getByRole('heading', { name: LABEL }), 400)
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.poll(() => onCommit.mock.calls).toEqual([[{ composer: 'Kenny Baker' }]])
})

it.each(['phone', 'wide'] as const)('discards typed text on Escape (%s)', async (frame) => {
  const { onCommit } = await openOn(frame)
  await type('Kenny Baker')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(onCommit).not.toHaveBeenCalled()
})

it.each(['phone', 'wide'] as const)(
  'writes nothing when the value did not change (%s)',
  async (frame) => {
    const { onCommit } = await openOn(frame)
    // Only whitespace differs, which the form trims away.
    await type(`  ${STORED} `)
    if (frame === 'phone') await page.getByRole('button', { name: DONE }).click()
    else
      await userEvent.click(page.elementLocator(document.body), { position: { x: 1200, y: 700 } })
    await expect.element(dialog()).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  },
)

it.each(['phone', 'wide'] as const)(
  'closes when the tune is deleted elsewhere (%s)',
  async (frame) => {
    const { onCommit, goAway, unmount } = await openOn(frame)
    await type('Kenny Baker')
    goAway()
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.element(page.getByRole('status')).toBeEmptyDOMElement()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    // Unmounting saves an edit still open, so this proves the close ended it unsaved.
    unmount()
    expect(onCommit).not.toHaveBeenCalled()
  },
)

it.each(['phone', 'wide'] as const)(
  'saves typed text when the editor unmounts with no dismissal (%s)',
  async (frame) => {
    const { onCommit, unmount } = await openOn(frame)
    await type('Kenny Baker')
    unmount()
    expect(onCommit.mock.calls).toEqual([[{ composer: 'Kenny Baker' }]])
  },
)

it('writes nothing when the editor unmounts after Escape', async () => {
  const { onCommit, unmount } = await openOn('wide')
  await type('Kenny Baker')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).not.toBeInTheDocument()
  unmount()
  expect(onCommit).not.toHaveBeenCalled()
})

it('discards typed text on Escape with focus left on the page', async () => {
  const { onCommit } = await openOn('wide')
  await type('Kenny Baker')
  ;(document.activeElement as HTMLElement).blur()
  await expect.poll(() => document.activeElement).toBe(document.body)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).not.toBeInTheDocument()
  expect(onCommit).not.toHaveBeenCalled()
})
