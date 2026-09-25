import { describe, expect, it } from 'vitest'
import openapi from './api/openapi.json'
import { INSTRUMENTS } from './api/vocabulary'
import {
  CAPO_FRETS,
  CAPO_INSTRUMENTS,
  GENRE_TYPES,
  STANDARD_TUNINGS,
  TUNE_TYPES,
  TUNINGS,
} from './constants'

describe('TUNE_TYPES', () => {
  it('offers Song, the type stored rows carry for a piece with words', () => {
    expect(TUNE_TYPES).toContain('Song')
  })
})

describe('GENRE_TYPES', () => {
  it('offers Cape Breton the Scottish types', () => {
    expect(GENRE_TYPES['Cape Breton']).toBe(GENRE_TYPES.Scottish)
  })
})

describe('instrument tables', () => {
  it('offers a capo exactly where the API accepts one', () => {
    const fields = openapi.components.schemas.Tunings.properties
    for (const instrument of INSTRUMENTS) {
      const refs = fields[instrument].anyOf.flatMap((option) =>
        '$ref' in option && typeof option.$ref === 'string' ? [option.$ref] : [],
      )
      expect(refs, instrument).toHaveLength(1)
      const fretted = refs[0] === '#/components/schemas/FrettedTuning'
      expect(CAPO_INSTRUMENTS[instrument], instrument).toBe(fretted)
    }
  })

  it('offers each standard tuning as that instrument’s first suggestion', () => {
    for (const [instrument, standard] of Object.entries(STANDARD_TUNINGS)) {
      expect(TUNINGS[instrument as keyof typeof TUNINGS][0]).toBe(standard)
    }
  })

  it('offers capo frets 1 to 12', () => {
    expect(CAPO_FRETS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
  })
})
