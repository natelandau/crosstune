import { IonInput, IonSelect, IonSelectOption } from '@ionic/react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { FieldRow } from './FieldRow'

const value = (text: string) => (
  <span data-row-value className="ms-auto truncate text-end">
    {text}
  </span>
)

describe('FieldRow', () => {
  it('puts the label at the leading edge and the value at the trailing edge', async () => {
    renderIonic(<FieldRow label="Genre">{value('Old-time')}</FieldRow>, { db: openTestDb() })
    await expect.element(page.getByText('Genre')).toBeVisible()
    const label = document.querySelector('[data-row-label]')!.getBoundingClientRect()
    const trailing = document.querySelector('[data-row-value]')!.getBoundingClientRect()
    expect(label.left).toBeLessThan(trailing.left)
  })

  it('names the detail field it edits', async () => {
    renderIonic(
      <FieldRow label="Genre" detail="Genre">
        {value('Not set')}
      </FieldRow>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Not set')).toBeVisible()
    expect(document.querySelector('[data-detail="Genre"]')).toBeTruthy()
  })

  it('keeps the label whole when the value outgrows the row', async () => {
    renderIonic(
      <div style={{ width: '393px' }}>
        <FieldRow label="Also known as">
          {value('Payday in the Army, Love Somebody, The Gal I Left Behind Me, Sally Ann Johnson')}
        </FieldRow>
      </div>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Also known as')).toBeVisible()
    const label = document.querySelector('[data-row-label]') as HTMLElement
    const trailing = document.querySelector('[data-row-value]') as HTMLElement
    // The value gives up its width first, so the label is never the thing that gets clipped.
    expect(trailing.scrollWidth).toBeGreaterThan(trailing.clientWidth)
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
  })

  it('mirrors in right-to-left text', async () => {
    renderIonic(
      <div dir="rtl" style={{ width: '393px' }}>
        <FieldRow label="Genre">{value('Old-time')}</FieldRow>
      </div>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Genre')).toBeVisible()
    const label = document.querySelector('[data-row-label]')!.getBoundingClientRect()
    const trailing = document.querySelector('[data-row-value]')!.getBoundingClientRect()
    expect(label.left).toBeGreaterThan(trailing.left)
  })

  it('pushes a select\u2019s value to the trailing edge, clear of its label', async () => {
    renderIonic(
      <div style={{ width: '393px' }}>
        <FieldRow label="Violin">
          <IonSelect aria-label="Violin tuning" placeholder="Not set">
            <IonSelectOption value="Cross A (AEAE)">Cross A (AEAE)</IonSelectOption>
          </IonSelect>
        </FieldRow>
      </div>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Violin')).toBeVisible()
    const select = document.querySelector('ion-select')!
    const label = document.querySelector('[data-row-label]')!.getBoundingClientRect()
    await vi.waitFor(() => {
      const shown = select.shadowRoot?.querySelector('.select-placeholder')
      expect(shown).toBeTruthy()
      // Ionic makes a control in an item flex:1, so without this the value starts hard against
      // the label and the row reads "ViolinNot set".
      expect(shown!.getBoundingClientRect().left).toBeGreaterThan(label.right + 80)
    })
  })

  it('pushes an input\u2019s text to the trailing edge', async () => {
    renderIonic(
      <div style={{ width: '393px' }}>
        <FieldRow label="Learned from">
          <IonInput aria-label="Learned from" value="Uncle Dave" />
        </FieldRow>
      </div>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Learned from')).toBeVisible()
    await vi.waitFor(() => {
      const input = document.querySelector('ion-input input')
      expect(input).toBeTruthy()
      expect(['end', 'right']).toContain(getComputedStyle(input!).textAlign)
    })
  })

  it('keeps the row at the 44px tap height', async () => {
    renderIonic(<FieldRow label="Genre">{value('Old-time')}</FieldRow>, { db: openTestDb() })
    await expect.element(page.getByText('Genre')).toBeVisible()
    const item = document.querySelector('ion-item')!
    expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })
})
