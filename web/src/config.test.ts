import { describe, expect, it } from 'vitest'
import { normalizeOrigin } from './config'

describe('normalizeOrigin', () => {
  it('reads an unset variable as the page origin', () => {
    expect(normalizeOrigin(undefined)).toBe('')
    expect(normalizeOrigin('')).toBe('')
    expect(normalizeOrigin('   ')).toBe('')
  })

  it('drops a trailing slash so a path is not doubled', () => {
    expect(normalizeOrigin('https://api.crosstune.app/')).toBe('https://api.crosstune.app')
    expect(normalizeOrigin('https://api.crosstune.app//')).toBe('https://api.crosstune.app')
  })

  it('keeps a host with a port and a base path', () => {
    expect(normalizeOrigin('http://localhost:8000')).toBe('http://localhost:8000')
    expect(normalizeOrigin(' https://edge.example/api ')).toBe('https://edge.example/api')
  })
})
