import { describe, expect, it } from 'vitest'
import { initials } from './initials'

describe('initials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['Cher', 'C'],
    ['  mary  ann  smith ', 'MS'],
  ])('reads %j as %j', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })

  it.each(['', '   ', null, undefined])('gives null for %j', (name) => {
    expect(initials(name)).toBeNull()
  })
})
