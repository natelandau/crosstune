import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'

const size = (selector: string) => getComputedStyle(document.querySelector(selector)!).fontSize

it('scales every role with the text size', async () => {
  try {
    renderWithProviders(<p className="t-body">Learned from Kenny.</p>, { density: 'touch' })
    const px = () => parseFloat(size('.t-body'))
    await expect.poll(px).toBeGreaterThan(0)
    const standard = px()
    document.documentElement.dataset.textSize = 'compact'
    await expect.poll(px).toBeLessThan(standard)
    document.documentElement.dataset.textSize = 'large'
    await expect.poll(px).toBeGreaterThan(standard)
  } finally {
    delete document.documentElement.dataset.textSize
  }
})

it('sets the timer in tabular figures', async () => {
  renderWithProviders(<p className="t-timer">1:42.6</p>, { density: 'touch' })
  await expect
    .poll(() => getComputedStyle(document.querySelector('.t-timer')!).fontVariantNumeric)
    .toContain('tabular-nums')
})

it.each([
  ['touch', 44],
  ['pointer', 24],
] as const)('sets %s target sizes at least the minimum target', async (density, least) => {
  renderWithProviders(<p>x</p>, { density })
  const variable = (name: string) =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  await expect.poll(() => variable('--target')).toBeGreaterThanOrEqual(least)
  expect(variable('--target-filter')).toBeGreaterThanOrEqual(least)
})

it.each([
  ['touch', undefined, '16px'],
  ['touch', 'compact', '16px'],
] as const)('a %s field at the %s text size is %s', async (density, textSize, px) => {
  if (textSize) document.documentElement.dataset.textSize = textSize
  try {
    renderWithProviders(<input aria-label="Title" className="t-secondary" />, { density })
    await expect.poll(() => size('input')).toBe(px)
  } finally {
    delete document.documentElement.dataset.textSize
  }
})

it('gives counts tabular figures', async () => {
  renderWithProviders(<span className="t-num">11 of 84 tunes</span>, { density: 'touch' })
  await expect
    .poll(() => getComputedStyle(document.querySelector('.t-num')!).fontVariantNumeric)
    .toContain('tabular-nums')
})

it('caps a paragraph at a readable measure, but not a centered note', async () => {
  renderWithProviders(
    <div style={{ width: '2000px' }}>
      <p className="t-secondary" data-testid="help">
        Recordings keep their place.
      </p>
      <p className="t-secondary text-center" data-testid="note">
        Waiting.
      </p>
    </div>,
    { density: 'touch' },
  )
  const width = (id: string) =>
    document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().width
  await expect.poll(() => width('help')).toBeLessThan(1000)
  expect(width('note')).toBe(2000)
})
