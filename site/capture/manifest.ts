import type { CaptureEntry, Manifest } from './types.ts'

/**
 * Replaces only the captures in `updates` and removes those in `drop`, keeping every other
 * entry, with keys sorted.
 */
export function mergeManifest(
  old: Manifest,
  updates: Record<string, CaptureEntry>,
  drop: string[] = [],
): Manifest {
  const all = { ...old.captures, ...updates }
  for (const name of drop) delete all[name]
  const captures: Record<string, CaptureEntry> = {}
  for (const key of Object.keys(all).sort()) captures[key] = all[key]
  return { captures }
}

/** The manifest as prettier would write it. */
export function formatManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
