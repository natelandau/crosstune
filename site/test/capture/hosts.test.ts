import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { HOST_STILLS, STILL_DIR, hostStillPath, splitNames } from '../../capture/hosts.ts'

describe('splitNames', () => {
  it('names the host stills the family shot needs', () => {
    expect(HOST_STILLS).toEqual(['family-mac', 'family-web', 'family-android'])
  })

  it('separates host stills from simulator captures', () => {
    expect(splitNames(['tunes', 'family-mac', 'lists'])).toEqual({
      hosts: ['family-mac'],
      simulator: ['tunes', 'lists'],
    })
  })

  it('treats a simulator still such as family-ipad as a simulator capture', () => {
    expect(splitNames(['family-ipad']).simulator).toEqual(['family-ipad'])
  })
})

describe('hostStillPath', () => {
  it('reads the Mac still from beside the Apple export folder', () => {
    expect(hostStillPath('family-mac', '/repo/apple/.build/capture/attachments')).toBe(
      '/repo/apple/.build/capture/family-mac.png',
    )
  })

  it.each(['family-web', 'family-android'])('reads %s from the web capture folder', (name) => {
    expect(hostStillPath(name, '/repo/apple/.build/capture/attachments')).toBe(
      join(STILL_DIR, `${name}.png`),
    )
    expect(STILL_DIR.endsWith(join('capture', '.out'))).toBe(true)
  })
})
