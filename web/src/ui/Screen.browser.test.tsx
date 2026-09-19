import {
  IonButton,
  IonItem,
  IonLabel,
  IonList,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
} from '@ionic/react'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { openTestDb } from '../test/db'
import { renderScreen } from '../test/ionic'
import { Screen } from './Screen'

describe('Screen', () => {
  it('shows the title, the actions, the search bar, and the content', async () => {
    // ion-button moves its aria-label off the host and onto the native button in its shadow
    // root, so only a shadow-piercing locator (not a Testing Library query) can find it.
    const { page } = await import('vitest/browser')
    renderScreen(
      <Screen
        title="Catalog"
        level="top"
        end={<IonButton aria-label="Add song">+</IonButton>}
        search={<IonSearchbar placeholder="Search songs" aria-label="Search songs" />}
      >
        <p>Body</p>
      </Screen>,
      { db: openTestDb(), path: '/catalog' },
    )
    expect(await screen.findByText('Body')).toBeInTheDocument()
    expect(screen.getAllByText('Catalog').length).toBeGreaterThan(0)
    await expect.element(page.getByLabelText('Add song')).toBeInTheDocument()
    expect(screen.getByLabelText('Search songs')).toBeInTheDocument()
  })

  it('lines the search bar up with the content column on the wide frame', async () => {
    const { page } = await import('vitest/browser')
    await page.viewport(1024, 768)
    try {
      renderScreen(
        <Screen title="Catalog" level="top" search={<IonSearchbar aria-label="Search songs" />}>
          <IonList>
            <IonItem>
              <IonLabel>Liberty</IonLabel>
            </IonItem>
          </IonList>
        </Screen>,
        { db: openTestDb(), path: '/catalog' },
      )
      expect(await screen.findByText('Liberty')).toBeInTheDocument()
      const list = document.querySelector('ion-list')!
      const searchbar = document.querySelector('ion-searchbar')!
      await vi.waitFor(() => {
        const listLeft = list.getBoundingClientRect().left
        expect(listLeft).toBeGreaterThan(0)
        expect(Math.abs(searchbar.getBoundingClientRect().left - listLeft)).toBeLessThanOrEqual(2)
        expect(
          Math.abs(searchbar.getBoundingClientRect().right - list.getBoundingClientRect().right),
        ).toBeLessThanOrEqual(2)
      })
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('places a refresher directly inside the content, where its fixed slot applies', async () => {
    renderScreen(
      <Screen
        title="Catalog"
        level="top"
        refresher={
          <IonRefresher slot="fixed">
            <IonRefresherContent />
          </IonRefresher>
        }
      >
        <p>Body</p>
      </Screen>,
      { db: openTestDb(), path: '/catalog' },
    )
    expect(await screen.findByText('Body')).toBeInTheDocument()
    expect(document.querySelector('ion-refresher')?.parentElement?.tagName).toBe('ION-CONTENT')
  })

  it('gives a pushed screen a back button', async () => {
    renderScreen(
      <Screen title="Soldier's Joy" level="pushed" backHref="/catalog">
        <p>Body</p>
      </Screen>,
      { db: openTestDb(), path: '/catalog/1' },
    )
    expect(await screen.findByText('Body')).toBeInTheDocument()
    expect(document.querySelector('ion-back-button')).not.toBeNull()
  })

  it('drops the back button while the screen wears a selection toolbar', async () => {
    renderScreen(
      <Screen title="2 selected" level="pushed" backHref="/lists" selecting>
        <p>Body</p>
      </Screen>,
      { db: openTestDb(), path: '/lists/1' },
    )
    expect(await screen.findByText('Body')).toBeInTheDocument()
    expect(document.querySelector('ion-back-button')).toBeNull()
  })

  it('caps the content column on the wide frame', async () => {
    const { page } = await import('vitest/browser')
    await page.viewport(1024, 768)
    try {
      renderScreen(
        <Screen title="Catalog" level="top">
          <p>Body</p>
        </Screen>,
        { db: openTestDb(), path: '/catalog' },
      )
      const column = (await screen.findByText('Body')).parentElement!
      expect(getComputedStyle(column).maxWidth).toBe('640px')
    } finally {
      await page.viewport(390, 844)
    }
  })
})
