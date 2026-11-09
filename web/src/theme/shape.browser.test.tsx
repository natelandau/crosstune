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

function Probes({ names }: { names: string[] }) {
  return (
    <>
      {names.map((name) => (
        <div key={name} data-probe={name} style={{ height: `var(${name})` }} />
      ))}
    </>
  )
}

const SIZES = ['--size-compact', '--size-regular', '--size-row', '--size-large']

it('scales every size with the text size setting', async () => {
  try {
    renderWithProviders(<Probes names={SIZES} />, { density: 'pointer' })
    await expect.poll(() => height('--size-row')).toBeGreaterThan(0)
    const standard = Object.fromEntries(SIZES.map((name) => [name, height(name)]))
    document.documentElement.dataset.textSize = 'large'
    const scale = () => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16
    await expect.poll(scale).toBeGreaterThan(1)
    for (const name of SIZES) {
      await expect.poll(() => height(name)).toBe(standard[name]! * scale())
    }
  } finally {
    delete document.documentElement.dataset.textSize
  }
})

it('draws a done check over time, and at once under reduced motion', async () => {
  renderWithProviders(<p>x</p>)
  const check = () => getComputedStyle(document.documentElement).getPropertyValue('--dur-check')
  await expect.poll(check).not.toBe('0.01ms')
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
