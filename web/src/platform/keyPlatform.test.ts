import { expect, it } from 'vitest'
import { keyPlatform } from './keyPlatform'

it.each([
  ['MacIntel', 'mac'],
  ['iPad', 'mac'],
  ['Win32', 'other'],
  ['Linux x86_64', 'other'],
])('reads %s as %s', (platform, expected) => {
  expect(keyPlatform({ platform })).toBe(expected)
})
