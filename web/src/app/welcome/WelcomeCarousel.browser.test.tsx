import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEXT_SLIDE,
  PREVIOUS_SLIDE,
  SIGN_IN_HEADLINE,
  SLIDE_COUNT,
  slideDotLabel,
  slideLabel,
  WELCOME_SLIDES,
} from '../../auth/links'
import { drag, swipeLeft, swipeRight } from '../../test/gestures'
import { renderWithProviders } from '../../test/render'
import { elementStill } from '../../test/stillPoll'
import { WelcomeCarousel } from './WelcomeCarousel'

const headline = (n: number) => WELCOME_SLIDES[n - 1]!.headline

/** The slide showing, as its group and its headline inside it. */
async function expectShowing(n: number) {
  const slide = page.getByRole('group', { name: slideLabel(n) })
  await expect.element(slide).toBeVisible()
  await expect.element(slide.getByRole('heading', { name: headline(n) })).toBeVisible()
}

/** The background a utility class paints under the scheme stamped on the page. */
function resolvedBackground(className: string) {
  const probe = document.createElement('div')
  probe.className = className
  document.body.append(probe)
  try {
    return getComputedStyle(probe).backgroundColor
  } finally {
    probe.remove()
  }
}

const slides = () => [...document.querySelectorAll('[aria-roledescription="slide"]')]

function renderCarousel(options?: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <>
      <span id="carousel-name">Crosstune</span>
      <WelcomeCarousel labelledBy="carousel-name" />
    </>,
    options,
  )
}

// Wider than a phone, where the arrows show; a phone's case sets its own width.
beforeEach(async () => {
  await page.viewport(1024, 800)
})

afterEach(async () => {
  vi.useRealTimers()
  await page.viewport(390, 844)
})

describe('WelcomeCarousel', () => {
  it('starts on the intro slide', async () => {
    renderCarousel()
    const first = page.getByRole('group', { name: slideLabel(1) })
    await expect.element(first).toBeVisible()
    await expect.element(first.getByRole('heading', { name: SIGN_IN_HEADLINE })).toBeVisible()
    await expect.element(page.getByText(headline(2))).not.toBeVisible()
    await expect
      .element(page.getByRole('region', { name: 'Crosstune' }))
      .toHaveAttribute('aria-roledescription', 'carousel')
  })

  it('next and previous move one slide and hide at the ends', async () => {
    renderCarousel()
    const previous = page.getByRole('button', { name: PREVIOUS_SLIDE })
    const next = page.getByRole('button', { name: NEXT_SLIDE })
    const hiddenPrevious = page.getByRole('button', { name: PREVIOUS_SLIDE, includeHidden: true })
    const hiddenNext = page.getByRole('button', { name: NEXT_SLIDE, includeHidden: true })
    await expect.element(next).toBeVisible()
    await expect.element(hiddenPrevious).not.toBeVisible()
    await next.click()
    await expectShowing(2)
    await expect.element(previous).toBeVisible()
    await previous.click()
    await expectShowing(1)
    for (let n = 2; n <= SLIDE_COUNT; n++) {
      await page.getByRole('button', { name: NEXT_SLIDE }).click()
      await expectShowing(n)
    }
    await expect.element(hiddenNext).not.toBeVisible()
    await expect.element(previous).toBeVisible()
  })

  it('keeps a hidden arrow in its place and out of the tab order', async () => {
    renderCarousel()
    const hiddenPrevious = page.getByRole('button', { name: PREVIOUS_SLIDE, includeHidden: true })
    const next = page.getByRole('button', { name: NEXT_SLIDE })
    await expect.element(next).toBeVisible()
    const startLeft = next.element().getBoundingClientRect().left
    await expect
      .poll(() => hiddenPrevious.element().getBoundingClientRect().width)
      .toBeGreaterThan(0)
    page
      .getByRole('button', { name: slideDotLabel(1) })
      .element()
      .focus()
    await userEvent.tab()
    await expect.element(next).toHaveFocus()
    await next.click()
    await expectShowing(2)
    await expect.poll(() => next.element().getBoundingClientRect().left).toBe(startLeft)
  })

  it('the dots are one tab stop', async () => {
    renderCarousel()
    const dot = (n: number) => page.getByRole('button', { name: slideDotLabel(n) })
    await expect.element(dot(1)).toBeVisible()
    dot(1).element().focus()
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: NEXT_SLIDE })).toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect.element(dot(1)).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expectShowing(3)
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: PREVIOUS_SLIDE })).toHaveFocus()
    // Back into the group lands on the current slide's dot.
    await userEvent.tab({ shift: true })
    await expect.element(dot(3)).toHaveFocus()
  })

  it('arrow keys on a dot move focus with the slide', async () => {
    renderCarousel()
    const dot = (n: number) => page.getByRole('button', { name: slideDotLabel(n) })
    await expect.element(dot(1)).toBeVisible()
    dot(1).element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expectShowing(2)
    await expect.element(dot(2)).toHaveFocus()
    await expect.element(dot(2)).toHaveAttribute('tabindex', '0')
    await expect.element(dot(1)).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{ArrowLeft}')
    await expectShowing(1)
    await expect.element(dot(1)).toHaveFocus()
    // Past the first slide it stays put.
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(dot(1)).toHaveFocus()
    await expect.element(dot(1)).toHaveAttribute('aria-current', 'true')
  })

  it('a dot jumps to its slide', async () => {
    renderCarousel()
    const dot = page.getByRole('button', { name: slideDotLabel(4) })
    await dot.click()
    await expectShowing(4)
    await expect.element(dot).toHaveAttribute('aria-current', 'true')
    await expect
      .element(page.getByRole('button', { name: slideDotLabel(1) }))
      .not.toHaveAttribute('aria-current')
  })

  it('arrow keys move the slide while focus is inside', async () => {
    renderCarousel()
    const dot = page.getByRole('button', { name: slideDotLabel(1) })
    await expect.element(dot).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    // Focus outside the carousel leaves it where it is.
    await expectShowing(1)
    dot.element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expectShowing(2)
    await userEvent.keyboard('{ArrowRight}')
    await expectShowing(3)
    await userEvent.keyboard('{ArrowLeft}')
    await expectShowing(2)
    // On an arrow, the keys move the slide and leave focus where it is.
    const next = page.getByRole('button', { name: NEXT_SLIDE })
    next.element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expectShowing(3)
    await expect.element(next).toHaveFocus()
  })

  it('leaves a modified arrow key to the browser', async () => {
    renderCarousel()
    const dot = page.getByRole('button', { name: slideDotLabel(1) })
    await expect.element(dot).toBeVisible()
    dot.element().focus()
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}')
    await userEvent.keyboard('{Meta>}{ArrowRight}{/Meta}')
    // The dot, not the slide, since a slide leaving stays drawn while it slides out.
    await expect.element(dot).toHaveAttribute('aria-current', 'true')
    await expect.element(dot).toHaveFocus()
    // Had either modified key paged, a plain one would land past slide 2.
    await userEvent.keyboard('{ArrowRight}')
    await expectShowing(2)
    await expect
      .element(page.getByRole('button', { name: slideDotLabel(2) }))
      .toHaveAttribute('aria-current', 'true')
  })

  it('keeps focus on an arrow when it reaches the end', async () => {
    renderCarousel()
    const next = page.getByRole('button', { name: NEXT_SLIDE })
    next.element().focus()
    for (let n = 2; n <= SLIDE_COUNT; n++) {
      await userEvent.keyboard('{Enter}')
      await expectShowing(n)
    }
    await expect.element(page.getByRole('button', { name: PREVIOUS_SLIDE })).toHaveFocus()
  })

  it('never moves on its own', async () => {
    vi.useFakeTimers()
    renderCarousel()
    await elementStill(page.getByRole('group', { name: slideLabel(1) })).toBeVisible()
    vi.advanceTimersByTime(60_000)
    await elementStill(page.getByRole('group', { name: slideLabel(1) })).toBeVisible()
    await elementStill(page.getByRole('heading', { name: SIGN_IN_HEADLINE })).toBeVisible()
    await elementStill(page.getByText(headline(2))).not.toBeVisible()
  })

  it('slides out of view are inert', async () => {
    renderCarousel()
    await expect.poll(() => slides().length).toBe(SLIDE_COUNT)
    await expect
      .poll(() => slides().map((slide) => slide.hasAttribute('inert')))
      .toEqual(WELCOME_SLIDES.map((_, n) => n !== 0))
    await page.getByRole('button', { name: NEXT_SLIDE }).click()
    await expect
      .poll(() => slides().map((slide) => slide.hasAttribute('inert')))
      .toEqual(WELCOME_SLIDES.map((_, n) => n !== 1))
  })

  it('a swipe moves it on touch, and a vertical drag does not', async () => {
    renderCarousel({ density: 'touch' })
    const first = page.getByRole('heading', { name: SIGN_IN_HEADLINE })
    await expect.element(first).toBeVisible()
    await drag(first, 0, 160)
    await expectShowing(1)
    await expect.element(page.getByText(headline(2))).not.toBeVisible()
    await swipeLeft(first, 160)
    await expectShowing(2)
    await swipeRight(page.getByRole('heading', { name: headline(2) }), 160)
    await expectShowing(1)
    // A short swipe springs back.
    await swipeLeft(first, 12)
    await expectShowing(1)
  })

  it('a mouse drag leaves it where it is', async () => {
    renderCarousel()
    const first = page.getByRole('heading', { name: SIGN_IN_HEADLINE })
    await expect.element(first).toBeVisible()
    await swipeLeft(first, 160, { pointerType: 'mouse' })
    await expect.element(page.getByRole('group', { name: slideLabel(1) })).toBeVisible()
    await expect.element(page.getByText(headline(2))).not.toBeVisible()
  })

  it('shows the dots alone, centered, at phone width', async () => {
    await page.viewport(390, 844)
    renderCarousel({ density: 'touch' })
    const first = page.getByRole('button', { name: slideDotLabel(1) })
    const last = page.getByRole('button', { name: slideDotLabel(SLIDE_COUNT) })
    await expect.element(last).toBeVisible()
    for (const name of [PREVIOUS_SLIDE, NEXT_SLIDE]) {
      await expect
        .element(page.getByRole('button', { name, includeHidden: true }))
        .not.toBeVisible()
    }
    await expect
      .poll(() => {
        const middle =
          (first.element().getBoundingClientRect().left +
            last.element().getBoundingClientRect().right) /
          2
        return Math.abs(middle - window.innerWidth / 2)
      })
      .toBeLessThan(2)
  })

  it.each(['light', 'dark'] as const)('draws every slide at phone width in %s', async (scheme) => {
    await page.viewport(390, 844)
    renderCarousel({ scheme })
    for (let n = 1; n <= SLIDE_COUNT; n++) {
      if (n > 1) await page.getByRole('button', { name: slideDotLabel(n) }).click()
      await expectShowing(n)
      const art = slides()[n - 1]!.querySelector('[data-slide-art]')!
      await expect.poll(() => art.getBoundingClientRect().height).toBeGreaterThan(100)
      await expect.poll(() => art.getBoundingClientRect().right <= window.innerWidth).toBe(true)
    }
    // The first slide's phone is jet on light paper and lifts to raised on dark paper.
    const phone = slides()[0]!.querySelector('.bg-device-bezel')!
    const jet = resolvedBackground('bg-jet')
    const raised = resolvedBackground('bg-surface-raised')
    expect(jet).not.toBe(raised)
    await expect
      .poll(() => getComputedStyle(phone).backgroundColor)
      .toBe(scheme === 'dark' ? raised : jet)
  })
})
