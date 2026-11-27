import { describe, expect, test } from 'vitest'
import { expectSameInstant, loadSharedCases } from './sharedCases'

// Exercises the loader itself; the Apple and API loaders read the same folder.
const validFiles = import.meta.glob('../../../fixtures/loader-checks/*.json', {
  eager: true,
  import: 'default',
})
const invalidFiles = import.meta.glob('../../../fixtures/loader-checks/invalid/*.json', {
  eager: true,
  import: 'default',
})

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

describe('loadSharedCases', () => {
  test('applies an override only on its own platform', () => {
    const [loaded] = loadSharedCases(validFiles, 'web')
    expect(loaded?.name).toBe('valid')
    expect(loaded?.expected).toEqual({ rows: ['shared'], count: 1 })
  })

  test.each([
    ['unknown-key.json', 'notes'],
    ['override-without-reason.json', 'reason'],
    ['override-unknown-field.json', 'missing'],
    ['expected-not-object.json', '"expected"'],
    ['input-missing.json', '"input"'],
    ['input-not-object.json', '"input"'],
    ['overrides-null.json', '"platform_overrides"'],
    ['description-empty.json', '"description"'],
    ['overrides-not-object.json', '"platform_overrides"'],
    ['override-not-object.json', '"apple" must be an object'],
    ['override-fields-missing.json', '"fields"'],
    ['override-fields-not-object.json', '"fields"'],
    ['override-unknown-platform.json', '"android"'],
  ])('refuses %s and names the broken rule', (fileName, brokenValue) => {
    const entries = Object.entries(invalidFiles).filter(([path]) => path.endsWith(`/${fileName}`))
    expect(entries).toHaveLength(1)
    expect(() => loadSharedCases(Object.fromEntries(entries), 'web')).toThrow(
      new RegExp(`${fileName}.*${escapeRegExp(brokenValue)}`),
    )
  })

  test('refuses an empty folder', () => {
    expect(() => loadSharedCases({}, 'web')).toThrow(/empty glob result/)
  })
})

describe('expectSameInstant', () => {
  test('treats equal instants with different precision as equal', () => {
    expectSameInstant('2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z')
    expectSameInstant(null, null)
  })

  test('fails on different instants', () => {
    expect(() => expectSameInstant('2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z')).toThrow()
    expect(() => expectSameInstant(null, '2026-01-01T00:00:00Z')).toThrow()
  })
})
