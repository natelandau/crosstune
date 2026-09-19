import { IonButton, IonContent, IonPage } from '@ionic/react'
import { screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { openTestDb } from './db'
import { renderIonic, renderScreen } from './ionic'

function Counter() {
  const [count, setCount] = useState(0)
  return <IonButton onClick={() => setCount((c) => c + 1)}>Count {count}</IonButton>
}

describe('browser mode', () => {
  it('renders an ionic component and responds to a real click', async () => {
    // ion-button renders its native <button> inside a shadow root, which Testing Library
    // queries do not cross, so the host is found by its text instead of an accessible role.
    renderIonic(<Counter />, { db: openTestDb() })
    const button = await screen.findByText('Count 0')
    await userEvent.click(button)
    expect(await screen.findByText('Count 1')).toBeInTheDocument()
  })

  it('renders a screen inside a router outlet', async () => {
    renderScreen(
      <IonPage>
        <IonContent>
          <h1>Hello</h1>
        </IonContent>
      </IonPage>,
      { db: openTestDb(), path: '/catalog' },
    )
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument()
  })
})
