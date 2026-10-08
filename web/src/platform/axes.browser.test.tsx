import { page } from 'vitest/browser'
import { afterEach, expect, it } from 'vitest'
import { renderHookWithProviders, renderWithProviders } from '../test/render'
import {
  flipSystemDark,
  restoreSystemDark,
  stubSystemDark,
  systemDarkListeners,
} from '../test/scheme'
import type { Appearance } from '../features/settings/appearance'
import { useSchemeSync } from '../theme/scheme'
import { useDensity, useStampedDensity } from './density'
import { useFrame } from './frame'

afterEach(async () => {
  await page.viewport(390, 844)
})

it.each([
  [390, 844, 'phone'],
  [844, 390, 'phone'],
  [820, 1180, 'split'],
  [1099, 800, 'split'],
  [1280, 800, 'wide'],
  [1280, 560, 'phone'],
])('a %ix%i window is the %s frame', async (w, h, frame) => {
  await page.viewport(w, h)
  const { result } = renderHookWithProviders(() => useFrame())
  await expect.poll(() => result.current).toBe(frame)
})

it('follows a system scheme change while appearance is System', async () => {
  stubSystemDark(false)
  try {
    renderHookWithProviders(() => useSchemeSync('system'))
    await expect.poll(() => document.documentElement.dataset.scheme).toBe('light')
    flipSystemDark(true)
    await expect.poll(() => document.documentElement.dataset.scheme).toBe('dark')
    await expect.poll(() => document.documentElement.style.colorScheme).toBe('dark')
    await expect.poll(() => getComputedStyle(document.body).backgroundColor).toBe('rgb(22, 24, 29)')
  } finally {
    restoreSystemDark()
    delete document.documentElement.dataset.scheme
    document.documentElement.style.removeProperty('color-scheme')
  }
})

it('stamps the density the pointer reports', async () => {
  expect(document.documentElement.dataset.density).toBeUndefined()
  renderHookWithProviders(() => useDensity())
  await expect.poll(() => document.documentElement.dataset.density).toBe('pointer')
})

it('follows the system scheme only while appearance is System', async () => {
  stubSystemDark(false)
  try {
    const { rerender } = renderHookWithProviders(({ appearance }) => useSchemeSync(appearance), {
      initialProps: { appearance: 'light' as Appearance },
    })
    await expect.poll(() => document.documentElement.dataset.scheme).toBe('light')
    expect(systemDarkListeners()).toBe(0)
    rerender({ appearance: 'system' })
    await expect.poll(systemDarkListeners).toBe(1)
    rerender({ appearance: 'dark' })
    await expect.poll(systemDarkListeners).toBe(0)
    expect(document.documentElement.dataset.scheme).toBe('dark')
  } finally {
    restoreSystemDark()
    delete document.documentElement.dataset.scheme
    document.documentElement.style.removeProperty('color-scheme')
  }
})

function DensityRoot() {
  return <p>{useDensity()}</p>
}

it('keeps the density a test asks for when the root stamps it', async () => {
  renderWithProviders(<DensityRoot />, { density: 'touch' })
  await expect.element(page.getByText('touch', { exact: true })).toBeVisible()
  expect(document.documentElement.dataset.density).toBe('touch')
})

it('removes the stamp when the density root leaves', async () => {
  const { unmount } = renderHookWithProviders(() => useDensity())
  await expect.poll(() => document.documentElement.dataset.density).toBe('pointer')
  unmount()
  expect(document.documentElement.dataset.density).toBeUndefined()
})

it('reads a density stamped after it mounts', async () => {
  const { result } = renderHookWithProviders(() => useStampedDensity(), { density: 'touch' })
  await expect.poll(() => result.current).toBe('touch')
  document.documentElement.dataset.density = 'pointer'
  await expect.poll(() => result.current).toBe('pointer')
})
