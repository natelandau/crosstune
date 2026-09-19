import { IonItem, IonLabel, IonList } from '@ionic/react'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOUSE_QUERY } from '../platform/pointer'
import { Screen } from '../ui/Screen'
import { Sheet } from '../ui/Sheet'
import { openTestDb } from './db'
import { renderIonic, renderScreen } from './ionic'

/** Relative luminance of an rgb() or rgba() color, 0 for black and 1 for white. */
function luminance(color: string): number {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
    const channel = Number(part) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function shadowBackground(host: Element, part: string): string {
  const element = host.shadowRoot?.querySelector(part)
  if (!element) throw new Error(`${part} has not rendered`)
  return getComputedStyle(element).backgroundColor
}

const group = (
  <IonList inset>
    <IonItem>
      <IonLabel>Card row</IonLabel>
    </IonItem>
  </IonList>
)

/** The item of the one visible card row, once Ionic has hydrated it. */
async function cardRow(): Promise<Element> {
  const label = await screen.findByText('Card row')
  return label.closest('ion-item')!
}

async function expectCardLighter(surface: () => string, card: Element) {
  await vi.waitFor(() => {
    const cardColor = shadowBackground(card, '.item-native')
    const surfaceColor = surface()
    expect(luminance(cardColor), `card ${cardColor} on ${surfaceColor}`).toBeGreaterThan(
      luminance(surfaceColor),
    )
  })
}

const originalMatchMedia = window.matchMedia

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

/**
 * Checks that a grouped screen, a touch sheet, and a mouse dialog draw their cards lighter than
 * the background behind them, in light and in dark mode, for whichever mode the project forces.
 */
export function groupedSurfaceTests(mode: string) {
  describe.each(['light', 'dark'])(`grouped surfaces on ${mode} in %s mode`, (theme) => {
    afterEach(() => {
      window.matchMedia = originalMatchMedia
      document.documentElement.classList.remove('ion-palette-dark')
    })

    const applyTheme = () =>
      document.documentElement.classList.toggle('ion-palette-dark', theme === 'dark')

    it('sets a grouped screen card lighter than the page', async () => {
      applyTheme()
      renderScreen(
        <Screen title="Song" level="pushed" grouped>
          {group}
        </Screen>,
        { db: openTestDb(), path: '/catalog/1' },
      )
      const card = await cardRow()
      const content = card.closest('ion-content')!
      await expectCardLighter(() => shadowBackground(content, '#background-content'), card)
    })

    it('sets a touch sheet card lighter than the sheet', async () => {
      applyTheme()
      forceTouch()
      renderIonic(
        <Sheet open title="Edit song" onClose={() => {}}>
          {group}
        </Sheet>,
        { db: openTestDb() },
      )
      const card = await cardRow()
      const content = card.closest('ion-content')!
      await expectCardLighter(() => shadowBackground(content, '#background-content'), card)
    })

    it('sets a mouse dialog card lighter than the dialog', async () => {
      applyTheme()
      renderIonic(
        <Sheet open title="Edit song" onClose={() => {}}>
          {group}
        </Sheet>,
        { db: openTestDb() },
      )
      const card = await cardRow()
      const body = card.closest('.sheet-dialog-body')!
      await expectCardLighter(() => getComputedStyle(body).backgroundColor, card)
    })
  })
}
