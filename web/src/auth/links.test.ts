import { describe, expect, it } from 'vitest'
import {
  resolveSiteUrl,
  SIGN_IN_HEADLINE,
  SIGN_UP_PATH,
  SLIDE_COUNT,
  slideDotLabel,
  slideLabel,
  WELCOME_SLIDES,
} from './links'

describe('links', () => {
  // The site links to this path, so moving it breaks every "Create free account" link.
  it('keeps sign-up at /sign-up', () => {
    expect(SIGN_UP_PATH).toBe('/sign-up')
  })

  it('falls back to production when unset or empty, and strips a trailing slash', () => {
    expect(resolveSiteUrl(undefined)).toBe('https://crosstune.app')
    expect(resolveSiteUrl('')).toBe('https://crosstune.app')
    expect(resolveSiteUrl('http://localhost:4321/')).toBe('http://localhost:4321')
  })

  it('opens the carousel on the story slide, six slides in all', () => {
    expect(WELCOME_SLIDES.map((slide) => slide.id)).toEqual([
      'story',
      'catalog',
      'record',
      'practice',
      'listen',
      'tuner',
    ])
    expect(WELCOME_SLIDES[0]?.headline).toBe(SIGN_IN_HEADLINE)
  })

  it('numbers the carousel controls out of six', () => {
    expect(SLIDE_COUNT).toBe(6)
    expect(slideDotLabel(2)).toBe('Slide 2 of 6')
    expect(slideLabel(2)).toBe('2 of 6')
  })
})
