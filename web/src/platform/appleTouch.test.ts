import { expect, it } from 'vitest'
import { isAppleTouch } from './appleTouch'

const nav = (userAgent: string, platform: string, maxTouchPoints: number) => ({
  userAgent,
  platform,
  maxTouchPoints,
})

it.each([
  ['an iPhone', nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5), true],
  ['an iPad that says so', nav('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad', 5), true],
  ['iPadOS as a Mac', nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), true],
  ['a Mac', nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), false],
  ['Android', nav('Mozilla/5.0 (Linux; Android 15)', 'Linux armv8l', 5), false],
])('reads %s as Apple touch: %s', (_, value, expected) => {
  expect(isAppleTouch(value)).toBe(expected)
})
