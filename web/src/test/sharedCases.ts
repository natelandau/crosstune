import { describe, expect, test } from 'vitest'

export type SharedCase<I, E> = { name: string; input: I; expected: E }

/** An ISO 8601 timestamp, such as a case's `updated_at`, and nothing more. */
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

type Platform = 'web'

const TOP_LEVEL_KEYS = ['description', 'input', 'expected', 'platform_overrides']
const PLATFORMS = ['web', 'apple', 'api']

// Code point order, matching the Swift and Python loaders; localeCompare differs by locale.
const compareCodePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turn the result of an eager `import.meta.glob` over `fixtures/<folder>/*.json` into cases
 * with the web platform's overrides merged over `expected`. Throws on a malformed case so a
 * broken fixture fails loudly instead of silently weakening a test.
 */
export function loadSharedCases<I, E>(
  files: Record<string, unknown>,
  platform: Platform,
): SharedCase<I, E>[] {
  const entries = Object.entries(files).sort(([a], [b]) => compareCodePoints(a, b))
  if (entries.length === 0) {
    throw new Error('Expected at least one case file, got an empty glob result with no .json files')
  }
  return entries.map(([path, raw]) => loadCase<I, E>(path, raw, platform))
}

function loadCase<I, E>(path: string, raw: unknown, platform: Platform): SharedCase<I, E> {
  const fileName = path.split('/').at(-1) ?? path
  const fail = (rule: string): never => {
    throw new Error(`${fileName}: ${rule}`)
  }
  const describe = (value: unknown) => JSON.stringify(value) ?? 'undefined'

  if (!isObject(raw)) return fail(`the top level must be an object, got ${describe(raw)}`)
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      fail(`top-level key "${key}" is not one of ${TOP_LEVEL_KEYS.join(', ')}`)
    }
  }
  if (typeof raw.description !== 'string' || raw.description.trim() === '') {
    fail(`"description" must be a non-empty string, got ${describe(raw.description)}`)
  }
  if (!('input' in raw)) fail('"input" is missing')
  if (!isObject(raw.input)) fail(`"input" must be an object, got ${describe(raw.input)}`)
  if (!isObject(raw.expected)) {
    fail(`"expected" must be an object, got ${describe(raw.expected)}`)
  }
  const expected: JsonObject = { ...(raw.expected as JsonObject) }

  const overrides = 'platform_overrides' in raw ? raw.platform_overrides : {}
  if (!isObject(overrides)) {
    return fail(`"platform_overrides" must be an object, got ${describe(overrides)}`)
  }
  for (const [overridePlatform, override] of Object.entries(overrides).sort(([a], [b]) =>
    compareCodePoints(a, b),
  )) {
    const label = `override "${overridePlatform}"`
    if (!PLATFORMS.includes(overridePlatform)) {
      fail(`${label} is not one of ${PLATFORMS.join(', ')}`)
    }
    if (!isObject(override)) fail(`${label} must be an object, got ${describe(override)}`)
    const { reason, fields } = override as JsonObject
    if (typeof reason !== 'string' || reason.trim() === '') {
      fail(`${label} needs a non-empty "reason", got ${describe(reason)}`)
    }
    if (!isObject(fields)) fail(`${label} "fields" must be an object, got ${describe(fields)}`)
    for (const field of Object.keys(fields as JsonObject)) {
      if (!(field in expected)) {
        fail(
          `${label} field "${field}" is absent from expected, which has ${Object.keys(expected).join(', ')}`,
        )
      }
    }
  }
  const platformOverride = overrides[platform] as { fields: JsonObject } | undefined
  Object.assign(expected, platformOverride?.fields)

  return {
    name: fileName.replace(/\.json$/, ''),
    input: raw.input as I,
    expected: expected as E,
  }
}

/** Assert two ISO 8601 strings name the same instant, whatever their precision. */
export function expectSameInstant(actual: string | null, expected: string | null): void {
  if (actual === null || expected === null) {
    expect(actual).toBe(expected)
    return
  }
  expect(Date.parse(actual)).toBe(Date.parse(expected))
}

/**
 * Declare a reader's tests: one that fails when fewer than `minimum` cases load, so a deleted
 * or misplaced fixture folder cannot pass, and one test per case, named for its file.
 */
export function describeSharedCases<I, E>(
  title: string,
  cases: SharedCase<I, E>[],
  minimum: number,
  run: (sharedCase: SharedCase<I, E>) => void | Promise<void>,
): void {
  describe(title, () => {
    test('finds the shared cases', () => {
      expect(cases.length).toBeGreaterThanOrEqual(minimum)
    })

    test.each(cases.map((sharedCase) => [sharedCase.name, sharedCase] as const))(
      '%s',
      (_name, sharedCase) => run(sharedCase),
    )
  })
}
