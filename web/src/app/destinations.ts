import { TABS } from './tabs'
import type { LucideIcon } from 'lucide-react'

export type Destination = 'catalog' | 'lists' | 'recordings' | 'settings'

export interface DestinationSpec {
  id: Destination
  label: string
  icon: LucideIcon
  root: string
}

export const DESTINATIONS: DestinationSpec[] = TABS.map((tab) => ({
  id: tab.tab,
  label: tab.label,
  icon: tab.icon,
  root: tab.href,
}))

/** The spec for one destination. */
export function destination(id: Destination): DestinationSpec {
  return DESTINATIONS.find((d) => d.id === id)!
}

const STORAGE_KEY = 'crosstune.destinations'

/** The destination a path belongs to, or null for paths outside the four, such as `/`. */
export function destinationOf(pathname: string): Destination | null {
  const first = pathname.split('/')[1]
  return DESTINATIONS.find((d) => d.id === first)?.id ?? null
}

/** Reads the session's mirror, dropping anything malformed or filed under the wrong destination. */
export function readStored(): Partial<Record<Destination, string>> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) return {}
    const memory: Partial<Record<Destination, string>> = {}
    for (const { id } of DESTINATIONS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (typeof value === 'string' && destinationOf(value.split(/[?#]/)[0] ?? value) === id)
        memory[id] = value
    }
    return memory
  } catch {
    return {}
  }
}

// Session-scoped so a reload keeps each destination's place, while a new tab starts at roots.
let memory = readStored()

export function rememberLocation(destination: Destination, location: string) {
  memory[destination] = location
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // Storage can be blocked; the in-memory map still serves this page load.
  }
}

export function rememberedLocation(destination: Destination): string | undefined {
  return memory[destination]
}

export function resetDestinationsForTest() {
  memory = {}
}
