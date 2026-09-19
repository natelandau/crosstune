import { IonItem, IonLabel, IonList } from '@ionic/react'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../../test/contrast'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { Screen } from '../../ui/Screen'

/** The background a shadow part paints, once Ionic has hydrated the component around it. */
function shadowStyle(host: Element, part: string): CSSStyleDeclaration {
  const element = host.shadowRoot?.querySelector(part)
  if (!element) throw new Error(`${part} has not rendered`)
  return getComputedStyle(element)
}

interface Surfaces {
  row: string
  page: string
  separator: string
}

/** The row color, the page under it, and the line md draws between rows. */
async function surfaces({ theme, inset }: { theme: string; inset: boolean }): Promise<Surfaces> {
  document.documentElement.classList.toggle('ion-palette-dark', theme === 'dark')
  renderScreen(
    <Screen title="Songs" level="top">
      <IonList inset={inset}>
        <IonItem>
          <IonLabel>Row 0</IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>Row 1</IonLabel>
        </IonItem>
      </IonList>
    </Screen>,
    { db: openTestDb(), path: '/catalog' },
  )
  const item = (await screen.findByText('Row 0')).closest('ion-item')!
  const content = item.closest('ion-content')!
  return await vi.waitFor(() => {
    const native = shadowStyle(item, '.item-native')
    const inner = shadowStyle(item, '.item-inner')
    const line = parseFloat(inner.borderBottomWidth) > 0 ? inner : native
    expect(parseFloat(line.borderBottomWidth)).toBeGreaterThan(0)
    return {
      row: native.backgroundColor,
      page: shadowStyle(content, '#background-content').backgroundColor,
      separator: line.borderBottomColor,
    }
  })
}

describe('md list surfaces', () => {
  afterEach(() => {
    document.documentElement.classList.remove('ion-palette-dark')
  })

  it('draws a plain list in dark mode on the page color', async () => {
    const { row, page } = await surfaces({ theme: 'dark', inset: false })
    expect(row, `row ${row} on page ${page}`).toBe(page)
  })

  it('keeps the separator of a flat dark list at least as strong as a light one', async () => {
    const light = await surfaces({ theme: 'light', inset: false })
    const dark = await surfaces({ theme: 'dark', inset: false })
    const lightRatio = contrastRatio(light.separator, light.row)
    const darkRatio = contrastRatio(dark.separator, dark.row)
    expect(darkRatio, `dark ${darkRatio} against light ${lightRatio}`).toBeGreaterThanOrEqual(
      lightRatio,
    )
  })

  it('leaves an inset list its own row color in dark mode', async () => {
    const { row, page } = await surfaces({ theme: 'dark', inset: true })
    expect(row, `card ${row} on page ${page}`).not.toBe(page)
  })
})
