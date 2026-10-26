import { Gauge, Play, TextQuote } from 'lucide-react'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../test/render'
import { Button } from './Button'
import { ActionButtonRow } from './ActionButtonRow'

afterEach(async () => {
  delete document.documentElement.dataset.textSize
  await page.viewport(390, 844)
})

/** How far each button's icon and label sit inside its edges, the smaller side. */
const insets = () =>
  [...document.querySelectorAll<HTMLElement>('[data-fit] button')].map((button) => {
    const outer = button.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(button)
    const inner = range.getBoundingClientRect()
    return Math.min(inner.left - outer.left, outer.right - inner.right)
  })

const row = () => (
  <div className="px-4">
    <ActionButtonRow tight>
      <Button variant="primary" icon={Play} solidIcon label="Play" fullWidth />
      <Button variant="tinted" icon={Gauge} label="Practice" fullWidth />
      <Button variant="tinted" icon={TextQuote} label="Lyrics" fullWidth />
    </ActionButtonRow>
  </div>
)

it('keeps its icons where three labels fit', async () => {
  await page.viewport(390, 844)
  renderWithProviders(row(), { density: 'touch' })
  await expect
    .poll(() => document.querySelector('[data-fit]')?.getAttribute('data-fit'))
    .toBe('full')
  await expect.poll(() => Math.min(...insets())).toBeGreaterThanOrEqual(4)
})

it('refits once the page fonts finish loading', async () => {
  await page.viewport(390, 844)
  // A fixed height keeps the stale fit from resizing the row, which would refit it on its own.
  renderWithProviders(<div className="[&_[data-fit]]:h-12">{row()}</div>, { density: 'touch' })
  const element = document.querySelector<HTMLElement>('[data-fit]')!
  // An observer starts with a first notification; wait for the row's own so it cannot refit later.
  await new Promise<void>((resolve) => {
    const observer = new ResizeObserver(() => {
      observer.disconnect()
      resolve()
    })
    observer.observe(element)
  })
  await expect.poll(() => element.dataset.fit).toBe('full')
  element.dataset.fit = 'bare'
  document.fonts.dispatchEvent(new Event('loadingdone'))
  await expect.poll(() => element.dataset.fit).toBe('full')
})

it.each([
  ['a narrow phone', undefined],
  ['a narrow phone at the largest text size', 'roomy'],
] as const)('fits every label inside its button on %s', async (_, textSize) => {
  if (textSize) document.documentElement.dataset.textSize = textSize
  await page.viewport(320, 640)
  renderWithProviders(row(), { density: 'touch' })
  await expect
    .poll(() => document.querySelector('[data-fit]')?.getAttribute('data-fit'))
    .not.toBe('full')
  await expect.poll(() => Math.min(...insets())).toBeGreaterThanOrEqual(4)
})
