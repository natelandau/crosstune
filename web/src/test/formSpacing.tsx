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
  return document.querySelector('ion-list.list-inset') as HTMLElement
}

/**
 * The spacing scale every form and every grouped screen inherits, checked for whichever mode
 * the project forces. Ionic injects an inset list's margin unlayered, where a class in a layer
 * cannot reach it, so the margins are measured rather than read off the class list.
 */
export function formSpacingTests(mode: string) {
  describe(`form spacing on ${mode}`, () => {
    it('leaves an inset list no vertical margin of its own', async () => {
      renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
      const style = getComputedStyle(await list())
      expect(px(style.marginTop)).toBe(0)
      expect(px(style.marginBottom)).toBe(0)
    })

    it('keeps the inset list at the 16px gutter', async () => {
      renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
      const style = getComputedStyle(await list())
      expect(px(style.marginLeft)).toBe(16)
      expect(px(style.marginRight)).toBe(16)
    })

    it('sets 24px above a header and 8px below it', async () => {
      renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
      await list()
      const section = document.querySelector('section') as HTMLElement
      const header = section.querySelector('h2') as HTMLElement
      expect(px(getComputedStyle(section).paddingTop)).toBe(24)
      expect(px(getComputedStyle(header).paddingTop)).toBe(0)
      expect(px(getComputedStyle(header).paddingBottom)).toBe(8)
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
      const header = document.querySelector('h2') as HTMLElement
      const footer = document.querySelector('section p') as HTMLElement
      const error = document.querySelector('[role="alert"]') as HTMLElement
      for (const element of [header, footer, error]) {
        const style = getComputedStyle(element)
        expect(px(style.paddingLeft), element.textContent ?? '').toBe(32)
        expect(px(style.paddingRight), element.textContent ?? '').toBe(32)
      }
      expect(px(getComputedStyle(footer).paddingTop)).toBe(8)
      expect(px(getComputedStyle(error).paddingTop)).toBe(8)
    })

    it('sets 16px above a section with no header', async () => {
      renderIonic(<Group>{row}</Group>, { db: openTestDb() })
      await list()
      const section = document.querySelector('section') as HTMLElement
      expect(px(getComputedStyle(section).paddingTop)).toBe(16)
    })

    it('holds the scale at every text size', async () => {
      document.documentElement.setAttribute('data-text-size', 'roomy')
      try {
        renderIonic(<Group header="Key">{row}</Group>, { db: openTestDb() })
        const style = getComputedStyle(await list())
        const header = document.querySelector('h2') as HTMLElement
        // The row inset the header lines up with is Ionic's, in px, so a scale in rem would
        // drift the header off the labels it names whenever the setting moves.
        expect(px(getComputedStyle(header).paddingLeft)).toBe(32)
        expect(px(style.marginLeft)).toBe(16)
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
      expect(px(getComputedStyle(section).paddingTop)).toBe(24)
      expect(px(getComputedStyle(section.querySelector('h2')!).paddingBottom)).toBe(8)
    })
  })
}
