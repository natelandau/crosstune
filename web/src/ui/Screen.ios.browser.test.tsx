import { IonItem, IonLabel, IonList, IonSearchbar } from '@ionic/react'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderScreen } from '../test/ionic'
import { Screen } from './Screen'

describe('Screen on iOS', () => {
  it('condenses the large title into the toolbar', async () => {
    renderScreen(
      <Screen title="Catalog" level="top">
        <p>Body</p>
      </Screen>,
      { db: openTestDb(), path: '/catalog' },
    )
    expect(await screen.findByText('Body')).toBeInTheDocument()
    expect(document.querySelector('ion-header.header-collapse-condense')).not.toBeNull()
  })
  it('lines the large title and search field up with the rows on the wide frame', async () => {
    await page.viewport(1024, 768)
    try {
      renderScreen(
        <Screen title="Catalog" level="top" search={<IonSearchbar aria-label="Search tunes" />}>
          <IonList>
            <IonItem>
              <IonLabel>Liberty</IonLabel>
            </IonItem>
          </IonList>
        </Screen>,
        { db: openTestDb(), path: '/catalog' },
      )
      const label = await screen.findByText('Liberty')
      await vi.waitFor(() => {
        const rowText = label.getBoundingClientRect().left
        expect(rowText).toBeGreaterThan(16)
        const field = document.querySelector('ion-searchbar .searchbar-input-container')!
        expect(Math.abs(field.getBoundingClientRect().left - rowText)).toBeLessThanOrEqual(2)
        // A page left by an earlier test stays in the DOM, hidden, with its own large title.
        const title = Array.from(document.querySelectorAll('ion-title.title-large'))
          .map((host) => host.shadowRoot?.querySelector('.toolbar-title'))
          .find((text) => text && text.getBoundingClientRect().width > 0)
        expect(title).toBeTruthy()
        expect(Math.abs(title!.getBoundingClientRect().left - rowText)).toBeLessThanOrEqual(2)
      })
    } finally {
      await page.viewport(390, 844)
    }
  })
})
