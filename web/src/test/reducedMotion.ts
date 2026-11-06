import { cdp } from 'vitest/browser'
import { expect, onTestFinished } from 'vitest'

/** Emulates `prefers-reduced-motion: reduce` until the test ends. */
export async function emulateReducedMotion(): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  onTestFinished(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] })
  })
  await expect.poll(() => matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
}
