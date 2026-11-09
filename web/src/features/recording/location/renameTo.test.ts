import { expect, it } from 'vitest'
import { renameTo } from './renameTo'

it.each([
  ['empty', ''],
  ['blank', '   '],
  ['unchanged', 'The barn '],
])('renames nothing to a name %s', (_, typed) => {
  expect(renameTo('The barn', typed)).toBeNull()
})

it('renames to the trimmed name typed', () => {
  expect(renameTo('The barn', ' Back barn ')).toBe('Back barn')
})
