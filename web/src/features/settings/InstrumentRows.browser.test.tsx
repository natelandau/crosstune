import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { Instrument } from '../../api/vocabulary'
import { INSTRUMENT_LABELS } from '../../constants'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { LISTED_INSTRUMENTS } from './instruments'
import { InstrumentRows } from './InstrumentRows'

const LABELS = LISTED_INSTRUMENTS.map((instrument) => INSTRUMENT_LABELS[instrument])
const LAST_LABEL = LABELS[LABELS.length - 1]!

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
  it('lists only instruments a song can show a tuning for', async () => {
    show([])
    await expect.element(page.getByRole('checkbox', { name: 'Violin' })).toBeInTheDocument()
    await expect.element(page.getByRole('checkbox', { name: '5-string banjo' })).toBeInTheDocument()
    await expect.element(page.getByRole('checkbox', { name: 'Guitar' })).not.toBeInTheDocument()
  })

  it('lists the listed instruments in their fixed order', async () => {
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
    show(['five_string_banjo'])
    await expect.element(box('5-string banjo')).toBeChecked()
    await expect.element(box('Violin')).not.toBeChecked()
  })

  it('reports an instrument turned on', async () => {
    const onToggle = vi.fn()
    show([], onToggle)
    await box('5-string banjo').click()
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith('five_string_banjo', true)
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
    await expect.element(box(LAST_LABEL)).toBeVisible()
    const items = document.querySelectorAll('ion-item')
    expect(items).toHaveLength(LABELS.length)
    for (const item of items) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
