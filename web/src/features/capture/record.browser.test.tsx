import { cdp, page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished } from 'vitest'
import { RECORD_LABEL, RECORD_TEXT, TAB_BAR } from '../../app/tabs'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { DISCARD_TITLE, FILING_UNDER, NEW_RECORDING, STOP } from './recordCopy'
import { RECORDINGS_SECTION } from '../tune/tuneScreenCopy'
import { ADD_RECORDING } from '../tune/tuneMediaCopy'
import { openTestDb } from '../../test/db'
import { FakeRecorder, fakeMediaForTest } from '../../test/fakeMedia'
import { CANCEL } from '../../ui/confirmCopy'
import { dragDown } from '../../test/gestures'

import { renderApp } from '../../test/renderApp'
import { TUNE } from '../tune/tunePageCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }

const sheet = () => page.getByRole('dialog', { name: NEW_RECORDING })
const recordControl = () => document.querySelector('[data-testid="record-control"]')
const recorderState = () => FakeRecorder.instances[0]?.state
const path = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname

async function seedTune(db: CrosstuneDb, title = "Soldier's Joy") {
  const { tuneId } = await createTune(db, { title }, { status: 'known' })
  return tuneId
}

/** Opens the recorder from the tune page's Add recording menu, which files under that tune. */
async function recordFromTunePage() {
  await page.getByRole('main', { name: TUNE }).getByRole('button', { name: ADD_RECORDING }).click()
  await page.getByRole('menuitem', { name: NEW_RECORDING }).click()
}

it('records from the dome at 390, with the timer up and the dome out of reach', async () => {
  fakeMediaForTest()
  await renderApp({ path: '/catalog', db: openTestDb(), frame: PHONE, density: 'touch' })
  await page.getByRole('button', { name: RECORD_LABEL }).click()

  await expect.element(sheet()).toBeVisible()
  await expect.element(sheet().getByRole('timer')).toBeVisible()
  await expect.element(sheet().getByRole('button', { name: STOP })).toBeVisible()
  await expect.poll(() => recordControl()?.getAttribute('aria-hidden')).toBe('true')
  await expect.element(page.getByRole('button', { name: RECORD_LABEL })).not.toBeInTheDocument()
  // The tabs sit behind the sheet, so no tab switch can leave a live take behind.
  const tabs = page.getByRole('navigation', { name: TAB_BAR, includeHidden: true })
  await expect.poll(() => tabs.element().closest('[inert]')).not.toBeNull()
})

it('stays open and recording through Escape, a backdrop press, a drag down, and back', async () => {
  fakeMediaForTest()
  const { router } = await renderApp({
    path: '/catalog',
    db: openTestDb(),
    frame: PHONE,
    density: 'touch',
  })
  await router.navigate('/recordings')
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  await expect.element(sheet().getByRole('timer')).toBeVisible()

  await userEvent.keyboard('{Escape}')
  const scrim = document.querySelector<HTMLElement>('[data-sheet-scrim]')!
  await userEvent.click(page.elementLocator(scrim), { position: { x: 20, y: 10 } })
  await dragDown(sheet(), 400)
  await router.navigate(-1)

  await expect.poll(path(router)).toBe('/recordings')
  await expect.element(sheet()).toBeVisible()
  await expect.element(page.getByRole('dialog', { name: DISCARD_TITLE })).not.toBeInTheDocument()
  expect(recorderState()).toBe('recording')
})

it('asks before Cancel discards a live take, and keeps recording when declined', async () => {
  fakeMediaForTest()
  const db = openTestDb()
  await renderApp({ path: '/catalog', db, frame: PHONE, density: 'touch' })
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  await expect.element(sheet().getByRole('timer')).toBeVisible()

  await sheet().getByRole('button', { name: CANCEL }).click()
  const question = page.getByRole('dialog', { name: DISCARD_TITLE })
  await expect.element(question).toBeVisible()
  await question.getByRole('button', { name: CANCEL }).click()

  await expect.element(question).not.toBeInTheDocument()
  await expect.element(sheet()).toBeVisible()
  expect(recorderState()).toBe('recording')
  expect(await db.recordings.count()).toBe(0)
})

it('files under the tune it started from and names it', async () => {
  fakeMediaForTest()
  const db = openTestDb()
  const tuneId = await seedTune(db)
  await renderApp({ path: `/catalog/${tuneId}`, db, frame: PHONE, density: 'touch' })
  await recordFromTunePage()

  await expect.element(sheet().getByText(`${FILING_UNDER} Soldier's Joy`)).toBeVisible()
})

it("saves on Stop and slides the new take into the tune's recordings", async () => {
  fakeMediaForTest()
  const db = openTestDb()
  const tuneId = await seedTune(db)
  const { router } = await renderApp({
    path: `/catalog/${tuneId}`,
    db,
    frame: PHONE,
    density: 'touch',
  })
  await recordFromTunePage()
  await expect.element(sheet().getByRole('timer')).toBeVisible()

  await sheet().getByRole('button', { name: STOP }).click()

  await expect.element(sheet()).not.toBeInTheDocument()
  await expect.poll(() => db.recordings.count()).toBe(1)
  const [saved] = await db.recordings.toArray()
  expect(saved!.tune_id).toBe(tuneId)
  const recordings = page.getByRole('main', { name: TUNE }).getByRole('grid', {
    name: RECORDINGS_SECTION,
  })
  await expect.element(recordings.getByRole('row')).toBeVisible()
  await expect.element(recordings.getByRole('row')).toHaveAttribute('data-new')
  // Already on the tune's page, so nothing was pushed.
  expect(path(router)()).toBe(`/catalog/${tuneId}`)
})

it('records from the sidebar capsule at 1280 and goes to Recordings once saved', async () => {
  fakeMediaForTest()
  const db = openTestDb()
  const { router } = await renderApp({ path: '/catalog', db, frame: WIDE, density: 'pointer' })
  const capsule = page.getByRole('button', { name: RECORD_LABEL })
  await expect.element(capsule).toHaveTextContent(RECORD_TEXT)
  await capsule.click()

  await expect.element(sheet().getByRole('timer')).toBeVisible()
  await expect.poll(() => recordControl()?.getAttribute('aria-hidden')).toBe('true')

  await sheet().getByRole('button', { name: STOP }).click()

  await expect.element(sheet()).not.toBeInTheDocument()
  await expect.poll(path(router)).toBe('/recordings')
  await expect.poll(() => document.querySelectorAll('[data-new]').length).toBe(1)
})

it.each([
  ['dome at 390', PHONE, 'touch'],
  ['capsule at 1280', WIDE, 'pointer'],
] as const)('grows out of the %s', async (_name, frame, density) => {
  fakeMediaForTest()
  await renderApp({ path: '/catalog', db: openTestDb(), frame, density })
  const control = page.getByRole('button', { name: RECORD_LABEL })
  const box = control.element().getBoundingClientRect()
  await control.click()

  await expect.element(sheet()).toBeVisible()
  // The sheet's surface is the dialog's parent, the box its scale grows from.
  const surface = sheet().element().parentElement!
  const originX = Number.parseFloat(surface.style.transformOrigin)
  const surfaceLeft = density === 'touch' ? 0 : surface.offsetLeft
  expect(surfaceLeft + originX).toBeCloseTo(box.left + box.width / 2, 0)
})

it.each([
  ['390x844', { width: 390, height: 844 }],
  ['375x667', { width: 375, height: 667 }],
])('keeps Stop on screen at %s with the filing line shown', async (_name, frame) => {
  fakeMediaForTest()
  const db = openTestDb()
  const tuneId = await seedTune(db)
  await renderApp({ path: `/catalog/${tuneId}`, db, frame, density: 'touch' })
  await recordFromTunePage()
  await expect.element(sheet().getByText(`${FILING_UNDER} Soldier's Joy`)).toBeVisible()
  const stop = sheet().getByRole('button', { name: STOP })
  await expect.element(stop).toBeVisible()

  // The sheet settles from below, so Stop's box is read once it has stopped moving.
  let last = Number.NaN
  await expect
    .poll(() => {
      const bottom = stop.element().getBoundingClientRect().bottom
      const settled = bottom === last
      last = bottom
      return settled
    })
    .toBe(true)
  expect(last).toBeLessThanOrEqual(window.innerHeight)
})

/** Records a take from the tune page and stops it, returning the tune's Recordings grid. */
async function saveTakeOnTunePage(db: CrosstuneDb) {
  const tuneId = await seedTune(db)
  await renderApp({ path: `/catalog/${tuneId}`, db, frame: PHONE, density: 'touch' })
  await recordFromTunePage()
  await expect.element(sheet().getByRole('timer')).toBeVisible()
  return {
    stop: () => sheet().getByRole('button', { name: STOP }).click(),
    recordings: () =>
      page.getByRole('main', { name: TUNE }).getByRole('grid', { name: RECORDINGS_SECTION }),
  }
}

it('marks the new take from the moment its row first appears', async () => {
  fakeMediaForTest()
  const db = openTestDb()
  const { stop } = await saveTakeOnTunePage(db)
  // Whether each row carried data-new as it entered the page.
  const entered: boolean[] = []
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations)
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue
        const rows = node.matches('[role="row"]') ? [node] : node.querySelectorAll('[role="row"]')
        for (const row of rows) entered.push(row.hasAttribute('data-new'))
      }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  onTestFinished(() => observer.disconnect())

  await stop()

  await expect.poll(() => entered.length).toBeGreaterThan(0)
  expect(entered.every(Boolean)).toBe(true)
})

it('keeps the wash and drops the slide under reduced motion', async () => {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  onTestFinished(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] })
  })
  fakeMediaForTest()
  const db = openTestDb()
  const { stop, recordings } = await saveTakeOnTunePage(db)

  await stop()

  const row = recordings().getByRole('row')
  await expect.element(row).toHaveAttribute('data-new')
  const style = getComputedStyle(row.element())
  expect(style.animationName).toBe('none')
  const wash = getComputedStyle(row.element(), '::after')
  expect(Number.parseFloat(wash.animationDuration)).toBeGreaterThan(0)
  expect(Number.parseFloat(wash.animationDelay)).toBe(0)
})
