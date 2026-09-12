import { describe, expect, it } from 'vitest'
import { pwaOptions } from './pwa.config'

describe('pwaOptions', () => {
  it('keeps every API path out of the navigation fallback', () => {
    const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? []
    expect(denylist.some((re) => re.test('/v1/sync/pull'))).toBe(true)
    expect(denylist.some((re) => re.test('/v1/links/resolve'))).toBe(true)
    expect(denylist.some((re) => re.test('/songs/abc'))).toBe(false)
  })

  it('caches no runtime responses and updates itself', () => {
    expect(pwaOptions.workbox?.runtimeCaching ?? []).toHaveLength(0)
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.disable).not.toBe(true)
  })
})
