/**
 * The name a rename step gives a saved location, or null when the name typed is blank or is the
 * one it already has.
 */
export function renameTo(current: string, typed: string): string | null {
  const name = typed.trim()
  return name !== '' && name !== current ? name : null
}
