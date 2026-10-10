import { frameData, MotionGlobalConfig } from 'motion/react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished } from 'vitest'
import { TAB_BAR } from '../../app/tabs'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { SELECT_TUNES, TUNE_LIST } from '../catalog/catalogCopy'
import { DURATION } from '../../theme/motion'
import { SELECT_ALL, SELECTION_ACTIONS } from './selectionCopy'

const PHONE = { width: 390, height: 844 }

async function seed(db: CrosstuneDb) {
  for (const title of ['Angeline the Baker', 'Forked Deer']) {
    await createTune(db, { title }, { status: 'known' })
  }
}

async function mount() {
  const db = openTestDb()
  await seed(db)
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await expect.element(row('Forked Deer')).toBeVisible()
}

const row = (title: string) =>
  page.getByRole('grid', { name: TUNE_LIST }).getByRole('row', { name: new RegExp(title) })
// By the page, not by role: a tab bar on its way out is inert, which hides it from roles.
const tabBar = () => document.querySelector<HTMLElement>(`nav[aria-label="${CSS.escape(TAB_BAR)}"]`)
const actions = () => page.getByRole('toolbar', { name: SELECTION_ACTIONS })
/** How far down, in percent of its height, an element is drawn; NaN when it is gone. */
const sunk = (element: HTMLElement | null) =>
  Number(/translateY\(([-\d.]+)%\)/.exec(element?.style.transform ?? '')?.[1] ?? NaN)
/** The box the action bar rises inside, which carries its slide. */
const actionsSlide = () => actions().element().parentElement!

async function startSelecting() {
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
  await expect.element(actions()).toBeInTheDocument()
}

/**
 * Runs `step` with Motion's clock held, so a slide started inside it stays where it began until
 * the test reads it or moves Motion's clock on by hand. Motion keeps its own frame loop, which
 * fake timers cannot reach; manual timing stops the time that loop reads, and letting it go runs
 * every held slide out.
 */
async function holdingMotion(step: () => Promise<void>) {
  MotionGlobalConfig.useManualTiming = true
  try {
    await step()
  } finally {
    MotionGlobalConfig.useManualTiming = false
  }
}

/** Every element a fade in was started on, from the browser's own animations. */
function watchFades(): Element[] {
  const faded: Element[] = []
  const animate = Element.prototype.animate
  Element.prototype.animate = function (this: Element, keyframes, options) {
    const opacity = (keyframes as PropertyIndexedKeyframes | null)?.opacity
    if (Array.isArray(opacity) && Number(opacity[0]) === 0) faded.push(this)
    return animate.call(this, keyframes, options)
  }
  onTestFinished(() => {
    Element.prototype.animate = animate
  })
  return faded
}

it('sinks the tab bar and raises the action bar as selecting starts on the phone', async () => {
  await holdingMotion(async () => {
    await mount()
    // Nothing moves on load.
    expect(tabBar()!.style.transform).toBe('none')
    await startSelecting()
    // On its way out, and inert, so nothing in it takes a press or focus.
    expect(tabBar()!.inert).toBe(true)
    expect(actionsSlide().style.transform).toBe('translateY(100%)')
    // Halfway through its time, the tab bar is partway down below the screen's foot.
    frameData.timestamp += (DURATION.base * 1000) / 2
    await expect.poll(() => sunk(tabBar())).toBeGreaterThan(0)
  })
  await expect.poll(tabBar).toBeNull()
  await expect.poll(() => actionsSlide().style.transform).toBe('none')
})

it('raises the tab bar back as selecting ends on the phone', async () => {
  await mount()
  await startSelecting()
  await expect.poll(tabBar).toBeNull()
  await holdingMotion(async () => {
    await userEvent.keyboard('{Escape}')
    await expect.poll(tabBar).not.toBeNull()
    expect(tabBar()!.inert).toBe(false)
    expect(tabBar()!.style.transform).toBe('translateY(150%)')
  })
  await expect.poll(() => tabBar()!.style.transform).toBe('none')
  await expect.element(actions()).not.toBeInTheDocument()
})

it("fades in the selection bar's controls as selecting starts, and the screen's as it ends", async () => {
  await mount()
  const faded = watchFades()
  const fadedAround = (name: string) => () => {
    const control = page.getByRole('button', { name, exact: true }).element()
    return faded.some((part) => part.contains(control))
  }
  await startSelecting()
  await expect.poll(fadedAround(SELECT_ALL)).toBe(true)
  await userEvent.keyboard('{Escape}')
  await expect.element(actions()).not.toBeInTheDocument()
  await expect.poll(fadedAround(MORE_ACTIONS)).toBe(true)
})
