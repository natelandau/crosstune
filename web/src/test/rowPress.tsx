import { IonLabel, IonList } from '@ionic/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { Mode } from '../platform/mode'
import { MOUSE_QUERY } from '../platform/pointer'
import { Row } from '../ui/Row'
import { openTestDb } from './db'
import { renderIonic } from './ionic'

const originalMatchMedia = window.matchMedia

/**
 * A row that opens through its own button is not the clickable item Ionic draws press feedback
 * for, so it carries that feedback itself. These checks hold it to whatever the row beside it
 * gets from Ionic in the same mode: the ripple only where an item would ripple, the tint
 * everywhere.
 */
export function rowPressTests(mode: Mode) {
  describe(`a pressed row on ${mode}`, () => {
    afterEach(() => {
      window.matchMedia = originalMatchMedia
    })

    function forceTouch() {
      window.matchMedia = (query: string) =>
        query === MOUSE_QUERY
          ? ({
              matches: false,
              media: query,
              addEventListener() {},
              removeEventListener() {},
            } as unknown as MediaQueryList)
          : originalMatchMedia.call(window, query)
    }

    async function render() {
      forceTouch()
      renderIonic(
        <IonList inset>
          <Row name="Cluck Old Hen" onOpen={() => {}}>
            <IonLabel>
              <h2>Cluck Old Hen</h2>
            </IonLabel>
          </Row>
          <Row name="Soldier's Joy" onOpen={() => {}} openName="Play">
            <IonLabel>
              <h2>Soldier's Joy</h2>
            </IonLabel>
          </Row>
        </IonList>,
        { db: openTestDb() },
      )
      const [plain, named] = Array.from(document.querySelectorAll('ion-list > ion-item'))
      await vi.waitFor(() => expect(plain!.shadowRoot?.querySelector('.item-native')).toBeTruthy())
      return { plain: plain!, open: named!.querySelector<HTMLButtonElement>('[data-row-open]')! }
    }

    it('ripples exactly where Ionic ripples an item it owns', async () => {
      const { plain, open } = await render()
      const ionic = Boolean(plain.shadowRoot!.querySelector('ion-ripple-effect'))
      expect(ionic).toBe(mode === 'md')
      expect(Boolean(open.querySelector('ion-ripple-effect'))).toBe(ionic)
    })

    it('tints the whole row while it is held, in either mode', async () => {
      const { open } = await render()
      expect(open.classList.contains('ion-activatable')).toBe(true)
      const tint = () => {
        const style = getComputedStyle(open, '::after')
        return { content: style.content, background: style.backgroundColor }
      }
      const resting = { content: 'none', background: 'rgba(0, 0, 0, 0)' }
      expect(tint()).toEqual(resting)
      let held = tint()
      // :active only holds while the button is down, so the press is read from inside it.
      const read = () => {
        held = tint()
      }
      document.addEventListener('mousedown', read, true)
      try {
        await page.getByRole('button', { name: "Play Soldier's Joy", exact: true }).click()
      } finally {
        document.removeEventListener('mousedown', read, true)
      }
      expect(held.content).toBe('""')
      expect(held.background).not.toBe(resting.background)
      // Ionic holds its own activation briefly past the release, then the row rests again.
      await vi.waitFor(() => expect(tint()).toEqual(resting))
    })
  })
}
