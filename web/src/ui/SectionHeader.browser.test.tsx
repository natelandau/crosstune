import { IonButton, IonContent, IonModal } from '@ionic/react'
import { screen } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { SectionHeader } from './SectionHeader'

const px = (value: string) => Number.parseFloat(value)

const addButton = (
  <IonButton fill="clear" className="section-action" aria-label="Add to list">
    <Plus aria-hidden="true" className="size-5" />
  </IonButton>
)

describe('SectionHeader', () => {
  it('renders an h2 with its text', async () => {
    renderIonic(<SectionHeader>Recent recordings</SectionHeader>, { db: openTestDb() })
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Recent recordings' }),
    ).toBeInTheDocument()
  })

  it('names its action in words and holds it at the 44px tap target', async () => {
    renderIonic(<SectionHeader actions={addButton}>Lists</SectionHeader>, { db: openTestDb() })
    const control = page.getByRole('button', { name: 'Add to list' })
    await expect.element(control).toBeVisible()
    const host = document.querySelector('ion-button')!
    const box = host.getBoundingClientRect()
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44)
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44)
  })

  it('sets a card off by the same distance with an action and without one', async () => {
    renderIonic(
      <>
        <SectionHeader>Notes</SectionHeader>
        <SectionHeader actions={addButton}>Lists</SectionHeader>
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('button', { name: 'Add to list' })).toBeVisible()
    const lines = document.querySelectorAll<HTMLElement>('[data-section-header]')
    expect(lines).toHaveLength(2)
    expect(Math.round(lines[0]!.getBoundingClientRect().height)).toBe(
      Math.round(lines[1]!.getBoundingClientRect().height),
    )
    expect(Math.round(lines[0]!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  })

  it('keeps the compact line inside a sheet, so a form section does not grow', async () => {
    renderIonic(
      <IonModal isOpen>
        <IonContent>
          <SectionHeader>Status</SectionHeader>
        </IonContent>
      </IonModal>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Status')).toBeVisible()
    const line = document.querySelector<HTMLElement>('ion-modal [data-section-header]')!
    expect(px(getComputedStyle(line).minHeight)).toBeLessThan(44)
  })

  it('carries a control on a naming header too, not only on a labeling one', async () => {
    renderIonic(
      <SectionHeader names actions={<button type="button">Add to list</button>}>
        Lists
      </SectionHeader>,
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('button', { name: 'Add to list' })).toBeVisible()
  })
})
