import { CrosstuneDb } from '../db/schema'

export function openTestDb(): CrosstuneDb {
  return new CrosstuneDb(`crosstune-test-${crypto.randomUUID()}`)
}
