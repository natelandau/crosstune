import { IonItem, IonLabel, IonList } from '@ionic/react'
import { screen } from '@testing-library/react'
import { Music } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'

describe('stylesheet cascade', () => {
  it('keeps the margin Ionic gives a slotted start icon', async () => {
    renderIonic(
      <IonList>
        <IonItem>
          <Music slot="start" data-testid="icon" className="size-6" aria-hidden />
          <IonLabel>Songs</IonLabel>
        </IonItem>
      </IonList>,
      { db: openTestDb() },
    )
    const icon = await screen.findByTestId('icon')
    await expect.poll(() => parseFloat(getComputedStyle(icon).marginInlineEnd)).toBeGreaterThan(0)
  })

  it('lets a utility class override Ionic heading margins', async () => {
    renderIonic(<h2 className="m-0">Heading</h2>, { db: openTestDb() })
    const heading = await screen.findByRole('heading', { name: 'Heading' })
    const style = getComputedStyle(heading)
    expect(style.marginTop).toBe('0px')
    expect(style.marginBottom).toBe('0px')
  })

  it('sets the root size from the text size setting', () => {
    const root = document.documentElement
    const previous = root.getAttribute('data-text-size')
    try {
      root.setAttribute('data-text-size', 'compact')
      expect(getComputedStyle(root).fontSize).toBe('15px')
      root.setAttribute('data-text-size', 'roomy')
      expect(getComputedStyle(root).fontSize).toBe('17px')
    } finally {
      if (previous === null) root.removeAttribute('data-text-size')
      else root.setAttribute('data-text-size', previous)
    }
  })
})
