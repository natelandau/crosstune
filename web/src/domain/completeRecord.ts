/** A record holding one value for each of `keys`, typed as complete. Throws when one is absent. */
export function completeRecord<K extends string, T>(
  keys: readonly K[],
  entries: Iterable<readonly [K, T]>,
): Record<K, T> {
  const record: Partial<Record<K, T>> = {}
  for (const [key, value] of entries) record[key] = value
  if (!hasEvery(keys, record)) throw new Error('A key is missing its value')
  return record
}

function hasEvery<K extends string, T>(
  keys: readonly K[],
  record: Partial<Record<K, T>>,
): record is Record<K, T> {
  return keys.every((key) => key in record)
}
