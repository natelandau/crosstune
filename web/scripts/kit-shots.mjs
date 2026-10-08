#!/usr/bin/env node
// Captures the app for a visual review: the kit at three widths, at each density, in
// light, dark, and the roomy text size, then the app's screens on a seeded fixture catalog,
// a few overlays, two frames of each page transition, and a WebKit pass. Headless only, so it
// never takes a window or focus from whoever is using the machine.
//
// The app runs from index.html with `?fixture`, which mounts it on a seeded local database with
// a signed-in test session and no network. `@clerk/react` is aliased to a stand-in here, so
// the sign-in screen renders with no Clerk instance.

import { mkdir, rm } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const OUT = fileURLToPath(new URL('../.cache/kit-shots/', import.meta.url))
const CLERK_STUB = fileURLToPath(new URL('../src/fixture/clerkStub.tsx', import.meta.url))

// Ids and titles from src/fixture/seed.ts.
const TUNE = 'soldier-s-joy'
const TUNE_TITLE = "Soldier's Joy"
const OTHER_TUNE = 'cluck-old-hen'
const OTHER_TITLE = 'Cluck Old Hen'
const LIST = 'thursday-jam'
const LIST_TUNE_TITLE = 'Forked Deer'
const SELECTED_TITLES = ['Angeline the Baker', 'Arkansas Traveler', 'Ashokan Farewell']
const RECORDING_LABEL = 'Porch jam'
// The take on TUNE the fixture holds audio and loops for, and the loop it leaves unnamed.
const PRACTICE_LABEL = 'Slow practice'
const UNNAMED_LOOP = 'loop-joy-b'
// Finds Soldier's Joy among tunes beside whatever else it matches.
const QUICK_FIND_QUERY = 'so'

// The fixture's clock: its seed dates count back from here and every label reads it, so a
// shot changes only when the app does, never with the day it was taken.
const NOW = '2026-10-06T16:00:00.000Z'

const PHONE = { name: '390', width: 390, height: 844 }
const SPLIT = { name: '820', width: 820, height: 1180 }
const DESKTOP = { name: '1280', width: 1280, height: 800 }
const SIZES = [PHONE, SPLIT, DESKTOP]

const DENSITIES = ['touch', 'pointer']

const LIGHT = { name: 'light', appearance: 'light', textSize: 'regular' }
const DARK = { name: 'dark', appearance: 'dark', textSize: 'regular' }
const ROOMY = { name: 'roomy-light', appearance: 'light', textSize: 'roomy' }
const LOOKS = [LIGHT, DARK, ROOMY]

/** The frames the app is captured on: each at the density its device has. */
const APP_FRAMES = [
  { size: PHONE, density: 'touch' },
  { size: SPLIT, density: 'touch' },
  { size: DESKTOP, density: 'pointer' },
]

/** A port nothing holds now, so the capture runs beside `just dev` on 5173. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

const errors = []

async function open(browser, url, size, density, look) {
  const touch = density === 'touch'
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    hasTouch: touch,
    isMobile: touch,
    colorScheme: look.appearance,
  })
  await context.addInitScript(
    ({ appearance, textSize }) => {
      localStorage.setItem('crosstune.appearance', appearance)
      localStorage.setItem('crosstune.textSize', textSize)
    },
    { appearance: look.appearance, textSize: look.textSize },
  )
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`${url}: ${error.message}`))
  await page.goto(url)
  return { context, page }
}

async function settle(page, density) {
  // The app stamps density from the hover media query, which emulation does not always flip,
  // and a width alone never implies a density.
  const stamped = await page.evaluate(() => document.documentElement.dataset.density)
  if (stamped !== density) {
    await page.evaluate((value) => {
      document.documentElement.dataset.density = value
    }, density)
  }
  await page.evaluate(() => document.fonts.ready)
}

async function openKit(browser, origin, size, density, look) {
  const { context, page } = await open(
    browser,
    `${origin}/kit?fixture&now=${NOW}`,
    size,
    density,
    look,
  )
  await page.getByRole('heading', { name: 'Kit', level: 1 }).waitFor()
  await settle(page, density)
  return { context, page }
}

async function openApp(browser, origin, { size, density, look = LIGHT, path, sync, signIn }) {
  const query = signIn ? 'fixture=signin' : `fixture&now=${NOW}${sync ? `&sync=${sync}` : ''}`
  const { context, page } = await open(browser, `${origin}${path}?${query}`, size, density, look)
  return { context, page }
}

const tuneRows = (page) => page.getByRole('grid', { name: 'Tunes' }).getByRole('row')
const tunePage = (page) => page.getByRole('main', { name: 'Tune' })

const grid = (page, name) => page.getByRole('grid', { name, exact: true })

/** Waits for the grid's first row, then for every image on the page to draw. */
async function gridReady(page, density, name) {
  await grid(page, name).getByRole('row').first().waitFor()
  await imagesDrawn(page)
  await settle(page, density)
}

async function imagesDrawn(page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img')].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  )
}

// Recordings group into a grid per tune, so a known row is the thing to wait for.
async function recordingsReady(page, density) {
  await page.getByRole('row', { name: new RegExp(RECORDING_LABEL) }).waitFor()
  await settle(page, density)
}

async function catalogReady(page, density) {
  await tuneRows(page).first().waitFor()
  await settle(page, density)
}

/** `scanned` says the tune holds a scan this browser could store, so its thumbnail must draw. */
async function tuneReady(page, density, { scanned = false } = {}) {
  await tunePage(page).getByRole('heading', { level: 1 }).waitFor()
  // On wide the list beside the page reads after the page does.
  await page.waitForFunction(() => {
    const grid = document.querySelector('[role=grid]')
    return !grid || grid.querySelector('[role=row]')
  })
  // A scan's thumbnail and the sidebar's list counts read after the page does. The fixture
  // has lists, so a sidebar with no list rows has not read yet.
  await page.waitForFunction((withScan) => {
    const sidebar = document.querySelector('nav[aria-label=Sidebar]')
    const lists = [...(sidebar?.querySelectorAll('a[href*="/lists/"]') ?? [])]
    const counted =
      !sidebar || (lists.length > 0 && lists.every((row) => row.querySelector('[data-count]')))
    const images = [...document.querySelectorAll('[aria-label=Scans] img')]
    const drawn = images.every((image) => image.complete && image.naturalWidth > 0)
    return counted && drawn && (!withScan || images.length > 0)
  }, scanned)
  await settle(page, density)
}

/**
 * Scrolls the element's scrolling column to its end, since the shell, not the page, scrolls.
 * Returns whether there was anything to scroll.
 */
async function scrollToEnd(locator) {
  return locator.evaluate((element) => {
    let column = element.parentElement
    while (column && column.scrollHeight <= column.clientHeight) column = column.parentElement
    column?.scrollTo({ top: column.scrollHeight, behavior: 'instant' })
    return (column?.scrollTop ?? 0) > 0
  })
}

/** Waits until an overlay stops moving, since its entrance is driven from script, not CSS. */
async function still(locator) {
  await locator.waitFor()
  let last = null
  for (let tries = 0; tries < 60; tries += 1) {
    const box = JSON.stringify(await locator.boundingBox())
    if (box === last) return
    last = box
    await locator.page().waitForTimeout(80)
  }
}

async function shoot(page, file, fullPage = false, animations = 'disabled') {
  const path = `${OUT}${file}.png`
  await page.screenshot({ path, fullPage, animations })
  console.log(`wrote ${path}`)
}

async function captureKit(browser, origin) {
  for (const size of SIZES) {
    for (const density of DENSITIES) {
      for (const look of LOOKS) {
        const { context, page } = await openKit(browser, origin, size, density, look)
        await shoot(page, `${size.name}-${density}-${look.name}`, true)
        await context.close()
      }
    }
  }

  let { context, page } = await openKit(browser, origin, PHONE, 'touch', LIGHT)
  await page.getByRole('button', { name: 'Part-height sheet' }).click()
  await still(page.getByRole('dialog', { name: 'Sort tunes' }))
  await shoot(page, '390-touch-light-sheet')
  await context.close()
  ;({ context, page } = await openKit(browser, origin, PHONE, 'touch', LIGHT))
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  // On touch the confirmation is an action sheet, so its message is the stable thing to find.
  await page.getByText('This removes its links and list entries.').waitFor()
  await shoot(page, '390-touch-light-confirm')
  await context.close()
  ;({ context, page } = await openKit(browser, origin, DESKTOP, 'pointer', LIGHT))
  await page.getByRole('button', { name: 'Show toast' }).click()
  await page.getByText('Archived 3 tunes').waitFor()
  // Opened from the keyboard so the shot also shows the focus ring on a menu item.
  await page.getByRole('button', { name: 'More actions' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menu').waitFor()
  await shoot(page, '1280-pointer-light-menu-toast')
  await context.close()
}

/** Catalog, catalog with Key D set and the key chooser open, tune page, tune form, sign-in. */
async function captureScreens(browser, origin, size, density, look) {
  const name = `app-${size.name}-${density}-${look.name}`
  let { context, page } = await openApp(browser, origin, { size, density, look, path: '/catalog' })
  await catalogReady(page, density)
  await shoot(page, `${name}-catalog`)

  await page.getByRole('button', { name: /^Key: / }).click()
  await page.getByRole('option', { name: 'D', exact: true }).click()
  await page.getByRole('button', { name: 'Key: D' }).click()
  await still(page.getByRole('option', { name: 'D', exact: true }))
  await shoot(page, `${name}-catalog-key`)
  await context.close()
  ;({ context, page } = await openApp(browser, origin, {
    size,
    density,
    look,
    path: `/catalog/${TUNE}`,
  }))
  await tuneReady(page, density, { scanned: true })
  await shoot(page, `${name}-tune`)
  // The pane bar takes the title once an observer sees the page title leave.
  if (await scrollToEnd(tunePage(page))) {
    await page.locator('[data-pane-title]:not([aria-hidden])', { hasText: TUNE_TITLE }).waitFor()
  }
  await shoot(page, `${name}-tune-end`)

  // Recording rows carry an Edit of their own, after the page's.
  await tunePage(page).getByRole('button', { name: 'Edit', exact: true }).first().click()
  await still(page.getByRole('dialog'))
  await settle(page, density)
  await shoot(page, `${name}-form`)
  await context.close()
  ;({ context, page } = await openApp(browser, origin, {
    size,
    density,
    look,
    path: '/',
    signIn: true,
  }))
  await page.getByRole('heading', { level: 1 }).waitFor()
  await settle(page, density)
  await shoot(page, `${name}-signin`)
  await context.close()
}

/** Every appearance variable the sign-in screen gives Clerk must name a token that resolves. */
async function checkClerkAppearance(browser, origin) {
  const { context, page } = await openApp(browser, origin, {
    size: PHONE,
    density: 'touch',
    path: '/',
    signIn: true,
  })
  await page.getByRole('heading', { level: 1 }).waitFor()
  const unresolved = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const values = [
      ...Object.values(window.__clerkAppearance?.variables ?? {}),
      ...Object.values(window.__clerkAppearance?.elements ?? {}).flatMap(Object.values),
    ]
    return values
      .flatMap((value) => [...String(value).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))
      .filter((name) => style.getPropertyValue(name).trim() === '')
  })
  if (unresolved.length) errors.push(`Clerk appearance names unset tokens: ${unresolved}`)
  else console.log('Clerk appearance: every token resolves')
  await context.close()
}

/**
 * Lists, a list page, selection, recordings and their sheets, Settings, stats, and the lyrics
 * and scan viewers, on one frame and look.
 */
async function captureLibrary(browser, origin, size, density, look) {
  const name = `app-${size.name}-${density}-${look.name}`
  const at = (path) => openApp(browser, origin, { size, density, look, path })

  let { context, page } = await at('/lists')
  await gridReady(page, density, 'Lists')
  await shoot(page, `${name}-lists`)
  await context.close()
  ;({ context, page } = await at(`/lists/${LIST}`))
  await gridReady(page, density, 'Tunes')
  await shoot(page, `${name}-list`)
  if (density === 'pointer') {
    // A keyboard drag held over its drop target, so the shot shows where the row would land.
    const row = grid(page, 'Tunes').getByRole('row', { name: new RegExp(LIST_TUNE_TITLE) })
    const move = row.getByRole('button', { name: `Move ${LIST_TUNE_TITLE}` })
    await row.focus()
    for (let step = 0; step < 6; step++) {
      if (await move.evaluate((button) => button === document.activeElement)) break
      await page.keyboard.press('ArrowRight')
    }
    await page.keyboard.press('Enter')
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label')?.startsWith('Insert '),
    )
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await shoot(page, `${name}-list-reorder`)
  }
  await context.close()
  ;({ context, page } = await at('/catalog'))
  await catalogReady(page, density)
  await page.getByRole('button', { name: 'More actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Select tunes' }).click()
  for (const title of SELECTED_TITLES) {
    await tuneRows(page).filter({ hasText: title }).click()
  }
  await page.getByText('3 selected', { exact: true }).first().waitFor()
  await settle(page, density)
  await shoot(page, `${name}-selecting`)
  await context.close()
  ;({ context, page } = await at('/recordings'))
  await recordingsReady(page, density)
  await shoot(page, `${name}-recordings`)
  await page.getByRole('button', { name: /^Filters/ }).click()
  await still(page.getByRole('dialog', { name: 'Filters' }))
  await shoot(page, `${name}-recordings-filters`)
  await context.close()
  ;({ context, page } = await at('/recordings'))
  await recordingsReady(page, density)
  // A right-click opens the row menu at every density, with no swipe or hover to stage.
  await page.getByRole('row', { name: new RegExp(RECORDING_LABEL) }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  await still(page.getByRole('dialog', { name: 'Edit recording' }))
  await settle(page, density)
  await shoot(page, `${name}-edit-recording`)
  await context.close()

  await captureSettings(browser, origin, size, density, look)

  ;({ context, page } = await at(`/catalog/${TUNE}`))
  await tuneReady(page, density, { scanned: true })
  await tunePage(page)
    .getByRole('button', { name: /^Open lyrics/ })
    .click()
  await still(page.getByRole('dialog', { name: `${TUNE_TITLE} lyrics` }))
  await shoot(page, `${name}-lyrics`)
  await context.close()
  ;({ context, page } = await at(`/catalog/${TUNE}`))
  await tuneReady(page, density, { scanned: true })
  await tunePage(page).getByRole('button', { name: 'Open scan 1', exact: true }).click()
  await still(page.getByRole('dialog', { name: `${TUNE_TITLE} scans` }))
  await imagesDrawn(page)
  await shoot(page, `${name}-scans`)
  await context.close()
}

/**
 * Practice on the fixture's take, then renaming its unnamed loop, which shows the suggestion
 * chips. Practice draws in the dark scheme in every appearance, so both looks are checked.
 */
async function capturePractice(browser, origin, size, density, look) {
  const name = `app-${size.name}-${density}-${look.name}`
  const { context, page } = await openApp(browser, origin, {
    size,
    density,
    look,
    path: `/catalog/${TUNE}`,
  })
  await tuneReady(page, density, { scanned: true })
  await tunePage(page)
    .getByRole('row', { name: new RegExp(PRACTICE_LABEL) })
    .getByText(PRACTICE_LABEL)
    .first()
    .click()
  await page
    .getByRole('region', { name: 'Player', exact: true })
    .getByRole('button', { name: /^Open / })
    .click()
  const practice = page.locator('[data-practice]').getByRole('dialog')
  await still(practice)
  await practice.locator('[data-practice-waveform]').waitFor()
  await settle(page, density)
  await shoot(page, `${name}-practice`)

  const pause = practice.getByRole('button', { name: 'Pause', exact: true })
  if (await pause.isVisible()) await pause.click()
  const tab = practice.locator(`button[data-name-tab="${UNNAMED_LOOP}"]`)
  for (let step = 0; step < 3 && !(await tab.isVisible()); step++) {
    await practice.getByRole('button', { name: 'Next loop', exact: true }).click()
  }
  await tab.click()
  await practice.getByRole('textbox', { name: 'Loop name', exact: true }).waitFor()
  await practice.getByRole('button', { name: 'B part' }).waitFor()
  await settle(page, density)
  await shoot(page, `${name}-practice-rename`)
  await context.close()
}

/** The page an unknown address lands on. */
async function captureNotFound(browser, origin, size, density, look) {
  const { context, page } = await openApp(browser, origin, {
    size,
    density,
    look,
    path: '/songs/old-link',
  })
  await page.getByRole('heading', { level: 1 }).waitFor()
  await settle(page, density)
  await shoot(page, `app-${size.name}-${density}-${look.name}-not-found`)
  await context.close()
}

/**
 * Quick Find empty and with results, then the shortcut sheet: from `?` on pointer, and from Quick
 * Find's command on touch, where single-key shortcuts do not run. A pending `G` shows nothing,
 * so it has no shot.
 */
async function captureKeyboard(browser, origin, size, density, look) {
  const name = `app-${size.name}-${density}-${look.name}`
  const quickFind = (page) => page.getByRole('dialog', { name: 'Quick Find' })
  const openQuickFind = async () => {
    const opened = await openApp(browser, origin, { size, density, look, path: '/catalog' })
    await catalogReady(opened.page, density)
    await opened.page.keyboard.press('ControlOrMeta+k')
    await still(quickFind(opened.page))
    await settle(opened.page, density)
    return opened
  }

  let { context, page } = await openQuickFind()
  await shoot(page, `${name}-quick-find`)
  await page.keyboard.type(QUICK_FIND_QUERY)
  await quickFind(page)
    .getByRole('option', { name: new RegExp(TUNE_TITLE) })
    .waitFor()
  await shoot(page, `${name}-quick-find-results`)
  await context.close()

  if (density === 'pointer') {
    ;({ context, page } = await openApp(browser, origin, { size, density, look, path: '/catalog' }))
    await catalogReady(page, density)
    await page.keyboard.press('?')
  } else {
    ;({ context, page } = await openQuickFind())
    await quickFind(page)
      .getByRole('option', { name: /^Keyboard shortcuts/ })
      .click()
  }
  await still(page.getByRole('dialog', { name: 'Keyboard shortcuts' }))
  await settle(page, density)
  await shoot(page, `${name}-shortcuts`)
  await context.close()
}

/** The Settings root, the Sync and storage page, and stats. */
async function captureSettings(browser, origin, size, density, look) {
  const name = `app-${size.name}-${density}-${look.name}`
  const at = (path) => openApp(browser, origin, { size, density, look, path })
  let { context, page } = await at('/settings')
  await gridReady(page, density, 'Settings categories')
  await shoot(page, `${name}-settings`)
  await context.close()
  ;({ context, page } = await at('/settings/sync'))
  await page.getByRole('progressbar', { name: 'Storage used' }).waitFor()
  await settle(page, density)
  await shoot(page, `${name}-settings-sync`)
  await context.close()
  ;({ context, page } = await at('/settings/stats'))
  await page.getByRole('heading', { name: 'Activity' }).waitFor()
  await settle(page, density)
  await shoot(page, `${name}-stats`)
  // The shell scrolls, not the page, so the lower blocks take shots of their own.
  const activity = page.getByRole('heading', { name: 'Activity' })
  await activity.evaluate((heading) => heading.scrollIntoView({ block: 'start' }))
  await shoot(page, `${name}-stats-activity`)
  await scrollToEnd(activity)
  await shoot(page, `${name}-stats-end`)
  await context.close()
}

async function captureExtras(browser, origin) {
  for (const { size, density } of APP_FRAMES) {
    await captureSettings(browser, origin, size, density, ROOMY)
    await captureScreens(browser, origin, size, density, ROOMY)
    await capturePractice(browser, origin, size, density, ROOMY)
  }
  let { context, page } = await openApp(browser, origin, {
    size: PHONE,
    density: 'touch',
    path: '/catalog',
  })
  await catalogReady(page, 'touch')
  await page.getByRole('heading', { level: 1 }).getByRole('button').click()
  await still(page.getByRole('menuitemradio').first())
  await shoot(page, 'app-390-touch-light-status-menu')
  await context.close()
  ;({ context, page } = await openApp(browser, origin, {
    size: SPLIT,
    density: 'touch',
    path: '/catalog',
  }))
  await catalogReady(page, 'touch')
  await page.getByRole('button', { name: /^Filters/ }).click()
  await still(page.getByRole('dialog'))
  await shoot(page, 'app-820-touch-light-filter-sheet')
  await context.close()
  // A landscape tablet: the wide frame at touch density.
  ;({ context, page } = await openApp(browser, origin, {
    size: { width: 1180, height: 820 },
    density: 'touch',
    path: `/catalog/${TUNE}`,
  }))
  await tuneReady(page, 'touch', { scanned: true })
  await shoot(page, 'app-1180-touch-light-tune')
  await context.close()
  for (const [size, density, sync] of [
    [PHONE, 'touch', 'error'],
    [DESKTOP, 'pointer', 'offline'],
  ]) {
    ;({ context, page } = await openApp(browser, origin, { size, density, path: '/catalog', sync }))
    await catalogReady(page, density)
    await shoot(page, `app-${size.name}-${density}-light-sync-${sync}`)
    await context.close()
  }
}

/**
 * Freezes the next view transition as soon as it starts, so a capture can step through it.
 * React starts it through `document.startViewTransition`, which this wraps.
 */
function holdNextTransition(page) {
  return page.evaluate(() => {
    window.__held = null
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = (update) => {
      const transition = start(update)
      transition.ready.then(() => {
        const animations = document
          .getAnimations()
          .filter((a) => a.effect?.pseudoElement?.startsWith('::view-transition'))
        for (const animation of animations) animation.pause()
        window.__held = animations
      })
      return transition
    }
  })
}

async function stepHeldTransition(page, file, fractions) {
  await page.waitForFunction(() => window.__held !== null)
  const count = await page.evaluate(() => window.__held.length)
  if (count === 0) errors.push(`${file}: the view transition had no animations`)
  for (const fraction of fractions) {
    await page.evaluate((at) => {
      for (const animation of window.__held) {
        const { delay = 0, duration } = animation.effect.getComputedTiming()
        animation.currentTime = delay + Number(duration) * at
      }
    }, fraction)
    await shoot(page, `${file}-${Math.round(fraction * 100)}`, false, 'allow')
  }
  await page.evaluate(() => window.__held.forEach((animation) => animation.finish()))
}

async function captureTransitions(browser, origin) {
  let { context, page } = await openApp(browser, origin, {
    size: PHONE,
    density: 'touch',
    path: '/catalog',
  })
  await catalogReady(page, 'touch')
  await holdNextTransition(page)
  await tuneRows(page).filter({ hasText: OTHER_TITLE }).click()
  await stepHeldTransition(page, 'app-390-touch-light-push', [0.35, 0.7])
  await context.close()
  ;({ context, page } = await openApp(browser, origin, {
    size: DESKTOP,
    density: 'pointer',
    path: `/catalog/${TUNE}`,
  }))
  await tuneReady(page, 'pointer', { scanned: true })
  await holdNextTransition(page)
  await tuneRows(page).filter({ hasText: OTHER_TITLE }).click()
  await stepHeldTransition(page, 'app-1280-pointer-light-crossfade', [0.35, 0.7])
  await tunePage(page).getByRole('heading', { level: 1, name: OTHER_TITLE }).waitFor()
  await context.close()
  ;({ context, page } = await openApp(browser, origin, {
    size: DESKTOP,
    density: 'pointer',
    path: `/catalog/${OTHER_TUNE}`,
  }))
  await tuneReady(page, 'pointer')
  await shoot(page, 'app-1280-pointer-light-tune-other')
  await context.close()
}

async function captureWebKit(origin) {
  const browser = await webkit.launch({ headless: true })
  try {
    let { context, page } = await openApp(browser, origin, {
      size: PHONE,
      density: 'touch',
      path: '/catalog',
    })
    await catalogReady(page, 'touch')
    await shoot(page, 'app-webkit-390-touch-light-catalog')
    await context.close()
    ;({ context, page } = await openApp(browser, origin, {
      size: PHONE,
      density: 'touch',
      path: `/catalog/${TUNE}`,
    }))
    // Playwright's WebKit refuses the fixture's scan, so this pass has none to wait for.
    await tuneReady(page, 'touch')
    await shoot(page, 'app-webkit-390-touch-light-tune')
    await context.close()
  } finally {
    await browser.close()
  }
}

const port = await freePort()
const server = await createServer({
  root: WEB,
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true },
  resolve: { alias: [{ find: /^@clerk\/react$/, replacement: CLERK_STUB }] },
})
let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${port}`
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  browser = await chromium.launch({ headless: true })
  await captureKit(browser, origin)
  for (const { size, density } of APP_FRAMES) {
    for (const look of [LIGHT, DARK]) {
      await captureScreens(browser, origin, size, density, look)
      await captureLibrary(browser, origin, size, density, look)
      await captureKeyboard(browser, origin, size, density, look)
      await capturePractice(browser, origin, size, density, look)
      await captureNotFound(browser, origin, size, density, look)
    }
  }
  await checkClerkAppearance(browser, origin)
  await captureExtras(browser, origin)
  await captureTransitions(browser, origin)
  await captureWebKit(origin)
} finally {
  await browser?.close()
  await server.close()
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
}
