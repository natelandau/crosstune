import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { FieldRow, RowValue } from './FieldRow'

const LONG =
  'Payday in the Army, Love Somebody, The Gal I Left Behind Me, Rickett’s Hornpipe, ' +
  'Sally Ann Johnson, Great Big Taters in the Sandy Land, Soldier’s Joy Number Two'

describe('FieldRow', () => {
  it('puts the label at the leading edge and the value at the trailing edge', async () => {
    renderIonic(
      <FieldRow label="Genre">
        <RowValue value="Old-time" placeholder="Not set" />
      </FieldRow>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Genre')).toBeVisible()
    const label = document.querySelector('[data-row-label]')!.getBoundingClientRect()
    const value = document.querySelector('[data-row-value]')!.getBoundingClientRect()
    expect(label.left).toBeLessThan(value.left)
  })

  it('names the detail field it edits', async () => {
    renderIonic(
      <FieldRow label="Genre" detail="Genre">
        <RowValue value="" placeholder="Not set" />
      </FieldRow>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Not set')).toBeVisible()
    expect(document.querySelector('[data-detail="Genre"]')).toBeTruthy()
  })

  it('shows the placeholder in the muted color and a value in the text color', async () => {
    renderIonic(
      <>
        <FieldRow label="Genre">
          <RowValue value="" placeholder="Not set" />
        </FieldRow>
        <FieldRow label="Feel">
          <RowValue value="Breakdown" placeholder="Not set" />
        </FieldRow>
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Breakdown')).toBeVisible()
    const [empty, set] = Array.from(document.querySelectorAll('[data-row-value]'))
    expect(getComputedStyle(empty!).color).not.toBe(getComputedStyle(set!).color)
  })

  // A value far longer than its row must not wrap the row or squeeze out its label.
  it('truncates a value longer than the row instead of wrapping it', async () => {
    renderIonic(
      <div style={{ width: '393px' }}>
        <FieldRow label="Also known as">
          <RowValue value={LONG} placeholder="Not set" />
        </FieldRow>
      </div>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Also known as')).toBeVisible()
    const value = document.querySelector('[data-row-value]') as HTMLElement
    const label = document.querySelector('[data-row-label]') as HTMLElement
    expect(value.scrollWidth).toBeGreaterThan(value.clientWidth)
    expect(getComputedStyle(value).textOverflow).toBe('ellipsis')
    expect(label.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
  })

  it('mirrors in right-to-left text', async () => {
    renderIonic(
      <div dir="rtl" style={{ width: '393px' }}>
        <FieldRow label="Genre">
          <RowValue value="Old-time" placeholder="Not set" />
        </FieldRow>
      </div>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Genre')).toBeVisible()
    const label = document.querySelector('[data-row-label]')!.getBoundingClientRect()
    const value = document.querySelector('[data-row-value]')!.getBoundingClientRect()
    expect(label.left).toBeGreaterThan(value.left)
  })

  it('keeps the row at the 44px tap height', async () => {
    renderIonic(
      <FieldRow label="Genre">
        <RowValue value="Old-time" placeholder="Not set" />
      </FieldRow>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Genre')).toBeVisible()
    const item = document.querySelector('ion-item')!
    expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })
})
