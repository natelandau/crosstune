import { describe, expect, it } from 'vitest'
import { compareNames } from './collate'

describe('compareNames', () => {
  it('orders titles alphabetically', () => {
    expect(['Swallowtail', 'Ashokan Farewell', 'Kesh'].sort(compareNames)).toEqual([
      'Ashokan Farewell',
      'Kesh',
      'Swallowtail',
    ])
  })

  it('treats case and accents as equal', () => {
    expect(compareNames('éire', 'Eire')).toBe(0)
  })
})
