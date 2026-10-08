import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'

const size = (selector: string) => getComputedStyle(document.querySelector(selector)!).fontSize

// Size, weight, and tracking for every role on each density.
const ROLES: Record<'touch' | 'pointer', [string, string, string, string][]> = {
  touch: [
    ['t-page-title', '30px', '700', '-0.6px'],
    ['t-screen-title', '28px', '700', '-0.56px'],
    ['t-heading', '17px', '600', '-0.17px'],
    ['t-body', '16px', '400', 'normal'],
    ['t-secondary', '14px', '400', 'normal'],
    ['t-caption', '12px', '500', 'normal'],
    ['t-timer', '56px', '300', 'normal'],
    ['t-lyrics', '26px', '400', 'normal'],
  ],
  pointer: [
    ['t-page-title', '26px', '700', '-0.52px'],
    ['t-screen-title', '22px', '700', '-0.44px'],
    ['t-heading', '15px', '600', '-0.15px'],
    ['t-body', '14px', '400', 'normal'],
    ['t-secondary', '12.5px', '400', 'normal'],
    ['t-caption', '11px', '500', 'normal'],
    ['t-timer', '48px', '300', 'normal'],
    ['t-lyrics', '26px', '400', 'normal'],
  ],
}

describe.each(['touch', 'pointer'] as const)('on %s', (density) => {
  it.each(ROLES[density])(
    'sets %s to %s, weight %s, tracking %s',
    async (role, px, weight, tracking) => {
      renderWithProviders(<p className={role}>Bonaparte's Retreat</p>, { density })
      const style = () => getComputedStyle(document.querySelector(`.${role}`)!)
      await expect.poll(() => style().fontSize).toBe(px)
      expect(style().fontWeight).toBe(weight)
      expect(style().letterSpacing).toBe(tracking)
    },
  )
})

it.each([
  ['compact', '15px'],
  ['roomy', '17px'],
] as const)('scales every role with the %s text size', async (textSize, px) => {
  document.documentElement.dataset.textSize = textSize
  try {
    renderWithProviders(<p className="t-body">Learned from Kenny.</p>, { density: 'touch' })
    await expect.poll(() => size('.t-body')).toBe(px)
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
  ['touch', { target: '44px', control: '44px', filter: '44px' }],
  ['pointer', { target: '32px', control: '28px', filter: '24px' }],
] as const)('sets %s target sizes', async (density, targets) => {
  renderWithProviders(<p>x</p>, { density })
  const variable = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  await expect.poll(() => variable('--target')).toBe(targets.target)
  expect(variable('--target-control')).toBe(targets.control)
  expect(variable('--target-filter')).toBe(targets.filter)
  expect(variable('--radius-surface')).toBe('14px')
})

it.each([
  ['touch', undefined, '16px'],
  ['touch', 'compact', '16px'],
  ['pointer', undefined, '12.5px'],
  ['pointer', 'compact', '11.7188px'],
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

it('gives floating surfaces a dark shadow of their own', async () => {
  const shadow = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--shadow-float').trim()
  renderWithProviders(<p>x</p>, { scheme: 'light' })
  await expect.poll(shadow).not.toBe('')
  const light = shadow()
  document.documentElement.dataset.scheme = 'dark'
  await expect.poll(shadow).not.toBe(light)
})
