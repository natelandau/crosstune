import { IonItem, IonLabel } from '@ionic/react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Group } from '../ui/Group'
import { openTestDb } from './db'
import { renderIonic } from './ionic'

const row = (
  <IonItem>
    <IonLabel>Card row</IonLabel>
  </IonItem>
)

const px = (value: string) => Number.parseFloat(value)

/** The first inset list on the page, once Ionic has hydrated it. */
async function list(): Promise<HTMLElement> {
  await expect.element(page.getByText('Card row').first()).toBeVisible()
  await expect.poll(() => document.querySelector('ion-list.list-inset')).not.toBeNull()
  return document.querySelector('ion-list.list-inset') as HTMLElement
}

/** A computed length in px, read again on every poll until the styles settle. */
const length = (element: Element, read: (style: CSSStyleDeclaration) => string) =>
  expect.poll(() => px(read(getComputedStyle(element))))

/**
 * The spacing scale every form and every grouped screen inherits, checked for whichever mode
 * the project forces. Ionic injects an inset list's margin unlayered, where a class in a layer
 * cannot reach it, so the margins are measured rather than read off the class list.
 */
export function formSpacingTests(mode: string) {
  describe(`form spacing on ${mode}`, () => {
    it('leaves an inset list no vertical margin of its own', async () => {
      renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
      const card = await list()
      await length(card, (style) => style.marginTop).toBe(0)
      await length(card, (style) => style.marginBottom).toBe(0)
    })

    it('keeps the inset list at the 16px gutter', async () => {
      renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
      const card = await list()
      await length(card, (style) => style.marginLeft).toBe(16)
      await length(card, (style) => style.marginRight).toBe(16)
    })

    it('sets 24px above a header and 8px below it', async () => {
      renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
      await list()
      const section = document.querySelector('section') as HTMLElement
      // The header's line owns the inset and the gap, so a control on it lines up with the
      // label beside it.
      const header = section.querySelector('[data-section-header]') as HTMLElement
      await length(section, (style) => style.paddingTop).toBe(24)
      await length(header, (style) => style.paddingTop).toBe(0)
      await length(header, (style) => style.paddingBottom).toBe(8)
    })

    it('keeps a header near the card it names, whatever its line is tall enough for', async () => {
      renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
      const card = await list()
      // The padding above says nothing about where the text sits once the line is tall enough
      // to hold a control, so this measures the text to the card instead.
      const text = document.querySelector('[data-section-header] h2') as HTMLElement
      const gap = () => card.getBoundingClientRect().top - text.getBoundingClientRect().bottom
      await expect.poll(gap).toBeGreaterThanOrEqual(0)
      await expect.poll(gap).toBeLessThanOrEqual(24)
    })

    it('aligns a header, a footer, and an error to the 32px text inset', async () => {
      renderIonic(
        <>
          <Group header="Key" footer="Pick one.">
            {row}
          </Group>
          <Group header="Title" error="A title is required">
            {row}
          </Group>
        </>,
        { db: openTestDb() },
      )
      await list()
      const header = document.querySelector('[data-section-header]') as HTMLElement
      const footer = document.querySelector('section p') as HTMLElement
      const error = document.querySelector('[role="alert"]') as HTMLElement
      for (const element of [header, footer, error]) {
        const message = element.textContent ?? ''
        await expect.poll(() => px(getComputedStyle(element).paddingLeft), { message }).toBe(32)
        await expect.poll(() => px(getComputedStyle(element).paddingRight), { message }).toBe(32)
      }
      await length(footer, (style) => style.paddingTop).toBe(8)
      await length(error, (style) => style.paddingTop).toBe(8)
    })

    it('sets 16px above a section with no header', async () => {
      renderIonic(<Group>{row}</Group>, { db: openTestDb() })
      await list()
      const section = document.querySelector('section') as HTMLElement
      await length(section, (style) => style.paddingTop).toBe(16)
    })

    it('holds the scale at every text size', async () => {
      document.documentElement.setAttribute('data-text-size', 'roomy')
      try {
        renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
        const card = await list()
        const header = document.querySelector('[data-section-header]') as HTMLElement
        // The row inset the header lines up with is Ionic's, in px, so a scale in rem would
        // drift the header off the labels it names whenever the setting moves.
        await length(header, (style) => style.paddingLeft).toBe(32)
        await length(card, (style) => style.marginLeft).toBe(16)
      } finally {
        document.documentElement.removeAttribute('data-text-size')
      }
    })

    it('renders a plain group with no list, keeping its header and spacing', async () => {
      renderIonic(
        <Group header="Key" plain>
          <p>Card row</p>
        </Group>,
        { db: openTestDb() },
      )
      await expect.element(page.getByText('Card row').first()).toBeVisible()
      expect(document.querySelector('ion-list')).toBeNull()
      const section = document.querySelector('section') as HTMLElement
      await length(section, (style) => style.paddingTop).toBe(24)
      await length(
        section.querySelector('[data-section-header]')!,
        (style) => style.paddingBottom,
      ).toBe(8)
    })
  })
}
