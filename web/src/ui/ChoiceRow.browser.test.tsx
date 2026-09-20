import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { ChoiceRow } from './ChoiceRow'
import { Group } from './Group'

const SIZES = ['compact', 'regular', 'roomy'] as const
type Size = (typeof SIZES)[number]
const LABELS: Record<Size, string> = {
  compact: 'Compact',
  regular: 'Regular',
  roomy: 'Roomy',
}

function Host({ onChange = () => {} }: { onChange?: (value: Size) => void }) {
  const [value, setValue] = useState<Size>('regular')
  // A choice row is always a row in a card, which is also what gives it its list semantics.
  return (
    <Group header="Appearance">
      <ChoiceRow
        label="Text size"
        value={value}
        options={SIZES}
        labels={LABELS}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    </Group>
  )
}

/** The name a screen reader announces: the field and the option it holds. */
const named = (value: string) =>
  page.getByRole('button', { name: `Text size, ${value}`, exact: true })

/** Ionic's own inner button takes no clicks, so the row is what opens the picker. */
const openPicker = async () => {
  await expect.element(page.getByText('Text size')).toBeVisible()
  await page.getByRole('listitem').click()
}

describe('ChoiceRow', () => {
  it('reads its label and the option it holds', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(named('Regular')).toBeInTheDocument()
    expect(document.querySelector('[data-row-label]')?.textContent).toBe('Text size')
  })

  it('offers every option and no empty choice', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await openPicker()
    await expect.element(page.getByRole('radio', { name: 'Compact' })).toBeVisible()
    expect(
      page
        .getByRole('radio')
        .elements()
        .map((option) => option.textContent?.trim()),
    ).toEqual(['Compact', 'Regular', 'Roomy'])
  })

  it('names the field it is setting in its own picker', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await openPicker()
    await expect.element(page.getByRole('radio', { name: 'Compact' })).toBeVisible()
    expect(document.querySelector('ion-popover')?.textContent).toContain('Text size')
  })

  it('reports a choice once and shows it in the row', async () => {
    const onChange = vi.fn()
    renderIonic(<Host onChange={onChange} />, { db: openTestDb() })
    await openPicker()
    await page.getByRole('radio', { name: 'Roomy' }).click()
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('roomy'))
    await expect.element(named('Roomy')).toBeInTheDocument()
  })

  it('keeps the row at the 44px tap height', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(page.getByText('Text size')).toBeVisible()
    const item = document.querySelector('ion-item')!
    expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })
})
