import { MotionGlobalConfig } from 'motion/react'
import { page, userEvent, type Locator } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { renderWithProviders } from '../test/render'
import { ComponentGallery, GALLERY_TITLE } from './ComponentGallery'

const SECTIONS = [
  'density',
  'foundations',
  'motion',
  'actions',
  'navigation',
  'choices',
  'values',
  'forms',
  'sheets',
] as const

type Density = 'pointer' | 'touch'

async function renderGallery(density: Density, scheme: 'light' | 'dark' = 'light') {
  renderWithProviders(<ComponentGallery />, { density, scheme })
  await expect.element(page.getByRole('heading', { name: GALLERY_TITLE })).toBeVisible()
  await document.fonts.ready
}

/** Waits until nothing animates, so no image catches a fade or a slide halfway. */
async function settled() {
  // A label's cross-fade overlaps two copies of its text, which reads as a heavier weight.
  await expect
    .poll(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    .toBe(0)
}

async function capture(locator: Locator, name: string) {
  await settled()
  await expect.element(locator).toMatchScreenshot(name)
}

/**
 * What an overlay shows on screen: a touch sheet's whole window, since the sheet's own box runs
 * past the window's bottom edge, or a popover's surface around its content.
 */
function onScreen(locator: Locator): Locator {
  const element = locator.element()
  return page.elementLocator(
    element.closest('[data-sheet-scrim]') ?? element.closest('[data-trigger]') ?? element,
  )
}

const section = (id: string) =>
  page.elementLocator(document.querySelector(`section[aria-labelledby="gallery-${id}"]`)!)

// Motion runs its springs and fades in its own frames, which `getAnimations` never lists, so
// instant animations put each element where it settles.
beforeEach(() => {
  MotionGlobalConfig.instantAnimations = true
})
afterEach(() => {
  MotionGlobalConfig.instantAnimations = false
})

describe.each(['light', 'dark'] as const)('%s', (scheme) => {
  describe.each(['pointer', 'touch'] as const)('%s', (density) => {
    it.each(SECTIONS)('%s', async (id) => {
      await renderGallery(density, scheme)
      await capture(section(id), `${id}-${scheme}-${density}`)
    })
  })
})

describe('states', () => {
  describe.each(['pointer', 'touch'] as const)('%s', (density) => {
    it('foundations with size guides', async () => {
      await renderGallery(density)
      await page.getByRole('button', { name: 'Show size guides' }).click()
      await expect.poll(() => document.querySelector('[data-size-guide]')).not.toBeNull()
      await capture(section('foundations'), `foundations-guides-light-${density}`)
    })

    it('menu open', async () => {
      await renderGallery(density)
      await page.getByRole('button', { name: 'More actions' }).click()
      const menu =
        density === 'pointer'
          ? page.getByRole('menu', { name: 'More actions' })
          : page.getByRole('dialog', { name: 'More actions' })
      await expect.element(menu).toBeVisible()
      await capture(onScreen(menu), `menu-open-light-${density}`)
    })

    it.each([
      ['delete', 'Confirm delete', 'Delete "Example"?'],
      ['caution', 'Confirm caution', 'Archive "Example"?'],
    ])('confirm %s open', async (kind, button, title) => {
      await renderGallery(density)
      await page.getByRole('button', { name: button }).click()
      // An action sheet on touch, an alert on pointer.
      const alert = page.getByRole(density === 'touch' ? 'dialog' : 'alertdialog', { name: title })
      await expect.element(alert).toBeVisible()
      await capture(onScreen(alert), `confirm-${kind}-light-${density}`)
    })
  })

  it('sheet open at pointer on a wide window', async () => {
    await page.viewport(1280, 800)
    onTestFinished(() => page.viewport(390, 844))
    await renderGallery('pointer')
    await page.getByRole('button', { name: 'Part-height sheet' }).click()
    const sheet = page.getByRole('dialog', { name: 'Sort items' })
    await expect.element(sheet).toBeVisible()
    await capture(onScreen(sheet), 'sheet-open-light-pointer')
  })

  it('sheet open at touch', async () => {
    await renderGallery('touch')
    await page.getByRole('button', { name: 'Part-height sheet' }).click()
    const sheet = page.getByRole('dialog', { name: 'Sort items' })
    await expect.element(sheet).toBeVisible()
    await capture(onScreen(sheet), 'sheet-open-light-touch')
  })

  it('tab hovered', async () => {
    await renderGallery('pointer')
    const tabs = page.getByRole('tablist', { name: 'Sections' })
    await userEvent.hover(tabs.getByRole('tab', { name: 'Activity' }))
    await capture(tabs, 'tab-hover-light-pointer')
  })

  it('checkbox hovered', async () => {
    await renderGallery('pointer')
    const checkbox = page.getByRole('checkbox', { name: 'Item 1' })
    // The drawn mark lies over the native input, so the pointer rests on the label around both.
    await userEvent.hover(page.elementLocator(checkbox.element().closest('label')!))
    await capture(
      page.elementLocator(checkbox.element().closest('section')!.lastElementChild!),
      'checkbox-hover-light-pointer',
    )
  })
})
