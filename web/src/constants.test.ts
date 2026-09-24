import { describe, expect, it } from 'vitest'
import openapi from './api/openapi.json'
import { INSTRUMENTS } from './api/vocabulary'
import { CAPO_FRETS, CAPO_INSTRUMENTS, STANDARD_TUNINGS, TUNE_TYPES, TUNINGS } from './constants'

describe('TUNE_TYPES', () => {
  it('offers Song, the type stored rows carry for a piece with words', () => {
    expect(TUNE_TYPES).toContain('Song')
  })
})

type Schemas = Record<string, { properties?: Record<string, { anyOf?: { $ref?: string }[] }> }>

describe('instrument tables', () => {
  it('offers a capo exactly where the API accepts one', () => {
    const schemas = openapi.components.schemas as unknown as Schemas
    const fields = schemas.Tunings!.properties!
    for (const instrument of INSTRUMENTS) {
      const ref = fields[instrument]!.anyOf!.find((option) => option.$ref)!.$ref!
      expect(CAPO_INSTRUMENTS[instrument], instrument).toBe(ref.endsWith('/FrettedTuning'))
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
