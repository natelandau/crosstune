import { MotionConfig } from 'motion/react'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { page } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { STATUS_LABELS } from '../constants'
import { renderWithProviders } from '../test/render'
import { StatusGlyph } from './StatusGlyph'

type Status = keyof typeof STATUS_LABELS
type Set = (status: Status) => void

function Glyph({ onSet }: { onSet: (set: Set) => void }) {
  const [status, setStatus] = useState<Status>('learning')
  // A second piece of state, so a later render flushes the effects of the one before it.
  const [, setTick] = useState(0)
  useEffect(
    () =>
      onSet((next) => {
        setStatus(next)
        setTick((tick) => tick + 1)
      }),
    [onSet],
  )
  return <StatusGlyph status={status} />
}

/**
 * Mounts the glyph and watches what animates. `set` lands a status, then renders once more so
 * the glyph's effect for it has run before the caller looks.
 */
async function mounted({ reduced = false } = {}) {
  const animate = vi.spyOn(Element.prototype, 'animate')
  let set: Set | null = null
  const glyph = <Glyph onSet={(next) => (set = next)} />
  renderWithProviders(
    reduced ? <MotionConfig reducedMotion="always">{glyph}</MotionConfig> : glyph,
    { density: 'pointer' },
  )
  await expect.element(page.getByRole('img', { name: STATUS_LABELS.learning })).toBeVisible()
  await expect.poll(() => set).not.toBeNull()
  const shape = () => page.getByRole('img').element()
  const popped = () => animate.mock.contexts.some((element) => element === shape())
  return {
    popped,
    set: (status: Status) => {
      flushSync(() => set!(status))
      flushSync(() => set!(status))
    },
  }
}

it('pops a new status in on the spring', async () => {
  const glyph = await mounted()
  glyph.set('known')
  await expect.element(page.getByRole('img', { name: STATUS_LABELS.known })).toBeVisible()
  expect(glyph.popped()).toBe(true)
})

it('holds still on the status it first shows', async () => {
  const glyph = await mounted()
  glyph.set('learning')
  expect(glyph.popped()).toBe(false)
})

it('changes in place under reduced motion', async () => {
  const glyph = await mounted({ reduced: true })
  glyph.set('known')
  await expect.element(page.getByRole('img', { name: STATUS_LABELS.known })).toBeVisible()
  expect(glyph.popped()).toBe(false)
})
