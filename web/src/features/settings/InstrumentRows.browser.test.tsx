import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { InstrumentRows } from './InstrumentRows'
import type { Instrument } from '../../constants'

const LABELS = [
  'Violin',
  'Banjo',
  'Guitar',
  'Mandolin',
  'Ukulele',
  'Bass',
  'Dulcimer',
  'Accordion',
  'Other',
]

function show(
  value: Instrument[],
  onToggle: (instrument: Instrument, on: boolean) => void = () => {},
) {
  return renderIonic(<InstrumentRows value={new Set(value)} onToggle={onToggle} />, {
    db: openTestDb(),
  })
}

const box = (name: string) => page.getByRole('checkbox', { name })

describe('InstrumentRows', () => {
  it('lists every instrument in its fixed order', async () => {
    show([])
    await expect.element(box('Violin')).toBeVisible()
    expect(
      page
        .getByRole('checkbox')
        .elements()
        .map((element) => element.textContent?.trim()),
    ).toEqual(LABELS)
  })

  it('checks only the instruments in the value', async () => {
    show(['banjo', 'guitar'])
    await expect.element(box('Banjo')).toBeChecked()
    await expect.element(box('Guitar')).toBeChecked()
    await expect.element(box('Violin')).not.toBeChecked()
  })

  it('reports an instrument turned on', async () => {
    const onToggle = vi.fn()
    show([], onToggle)
    await box('Banjo').click()
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith('banjo', true)
  })

  it('reports an instrument turned off', async () => {
    const onToggle = vi.fn()
    show(['violin'], onToggle)
    await box('Violin').click()
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith('violin', false)
  })

  it('gives every row a tap target a finger can hit', async () => {
    show([])
    await expect.element(box('Other')).toBeVisible()
    const items = document.querySelectorAll('ion-item')
    expect(items).toHaveLength(LABELS.length)
    for (const item of items) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
