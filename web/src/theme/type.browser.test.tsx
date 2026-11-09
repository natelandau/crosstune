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
  ['touch', { target: '44px', filter: '44px' }],
  ['pointer', { target: '32px', filter: '24px' }],
] as const)('sets %s target sizes', async (density, targets) => {
  renderWithProviders(<p>x</p>, { density })
  const variable = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  await expect.poll(() => variable('--target')).toBe(targets.target)
  expect(variable('--target-filter')).toBe(targets.filter)
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

it.each(['t-body', 't-secondary', 't-caption'])(
  'wraps %s without a lone last word',
  async (role) => {
    renderWithProviders(<p className={role}>Learned from Kenny.</p>, { density: 'touch' })
    await expect
      .poll(() =>
        getComputedStyle(document.querySelector(`.${role}`)!).getPropertyValue('text-wrap-style'),
      )
      .toBe('pretty')
  },
)

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

it.each(['--shadow-float', '--shadow-lift'])('gives %s a dark shadow of its own', async (name) => {
  const shadow = () => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  renderWithProviders(<p>x</p>, { scheme: 'light' })
  await expect.poll(shadow).not.toBe('')
  const light = shadow()
  document.documentElement.dataset.scheme = 'dark'
  await expect.poll(shadow).not.toBe(light)
})
