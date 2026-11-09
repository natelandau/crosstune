import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { InRow, useControlSize } from '../ui/inRow'
import { renderWithProviders } from '../test/render'
import { emulateReducedMotion } from '../test/reducedMotion'
import { DURATION, EASE_CSS, EASE_POP_CSS } from './motion'

const height = (name: string) => {
  const probe = document.querySelector<HTMLElement>(`[data-probe="${name}"]`)!
  return probe.getBoundingClientRect().height
}

function Probes({ names, prop = 'height' }: { names: string[]; prop?: 'height' | 'borderRadius' }) {
  return (
    <>
      {names.map((name) => (
        <div key={name} data-probe={name} style={{ [prop]: `var(${name})` }} />
      ))}
    </>
  )
}

const SIZES = ['--size-compact', '--size-regular', '--size-row', '--size-large']

it.each([
  ['pointer', 24, 28, 40, 36],
  ['touch', 32, 36, 48, 48],
] as const)('sizes the four heights for %s', async (density, compact, regular, row, large) => {
  renderWithProviders(<Probes names={SIZES} />, { density })
  await expect.poll(() => height('--size-compact')).toBe(compact)
  await expect.poll(() => height('--size-regular')).toBe(regular)
  await expect.poll(() => height('--size-row')).toBe(row)
  await expect.poll(() => height('--size-large')).toBe(large)
})

it('scales every size with the text size setting', async () => {
  document.documentElement.dataset.textSize = 'large'
  try {
    renderWithProviders(<Probes names={SIZES} />, { density: 'pointer' })
    const scale = () => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16
    await expect.poll(scale).toBeGreaterThan(1)
    await expect.poll(() => height('--size-row')).toBe(40 * scale())
    expect(height('--size-compact')).toBe(24 * scale())
  } finally {
    delete document.documentElement.dataset.textSize
  }
})

it('keeps the row 16px taller than compact at the default text size', async () => {
  renderWithProviders(<Probes names={SIZES} />, { density: 'pointer' })
  await expect.poll(() => height('--size-row') - height('--size-compact')).toBe(16)
})

it('draws every control corner at 8px', async () => {
  renderWithProviders(
    <Probes names={['--radius', '--radius-inner', '--radius-item']} prop="borderRadius" />,
  )
  const radius = (name: string) =>
    getComputedStyle(document.querySelector(`[data-probe="${name}"]`)!).borderTopLeftRadius
  await expect.poll(() => radius('--radius')).toBe('8px')
  expect(radius('--radius-inner')).toBe('6px')
  expect(radius('--radius-item')).toBe('4px')
})

it('draws a done check in 300ms, and at once under reduced motion', async () => {
  renderWithProviders(<p>x</p>)
  const check = () => getComputedStyle(document.documentElement).getPropertyValue('--dur-check')
  await expect.poll(check).toBe('300ms')
  await emulateReducedMotion()
  await expect.poll(check).toBe('0.01ms')
})

it('times script motion with the same tokens as CSS', async () => {
  renderWithProviders(<p>x</p>)
  const token = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  await expect.poll(() => token('--ease')).toBe(EASE_CSS)
  expect(token('--ease-pop')).toBe(EASE_POP_CSS)
  for (const [name, seconds] of Object.entries(DURATION)) {
    expect(token(`--dur-${name}`)).toBe(`${seconds * 1000}ms`)
  }
})

describe('useControlSize', () => {
  const inRow = ({ children }: { children: ReactNode }) =>
    createElement(InRow.Provider, { value: true }, children)

  it('gives a control in a row the compact size', () => {
    expect(renderHook(() => useControlSize(), { wrapper: inRow }).result.current).toBe('compact')
    expect(renderHook(() => useControlSize()).result.current).toBe('regular')
  })

  it('lets an explicit size win', () => {
    expect(renderHook(() => useControlSize('large'), { wrapper: inRow }).result.current).toBe(
      'large',
    )
    expect(renderHook(() => useControlSize('large')).result.current).toBe('large')
  })
})
