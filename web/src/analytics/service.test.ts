import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../api/vocabulary'
import { serviceOf } from './service'

describe('serviceOf', () => {
  it('maps every provider the app stores to the plan service of the same name', () => {
    for (const provider of PROVIDERS) expect(serviceOf(provider)).toBe(provider)
  })

  it('maps a provider this client does not know to other', () => {
    expect(serviceOf('from_the_future')).toBe('other')
  })
})
